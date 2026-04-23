import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  DEFAULT_BREWVA_CONFIG,
  EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
  EXEC_FALLBACK_HOST_EVENT_TYPE,
  EXEC_ROUTED_EVENT_TYPE,
  EXEC_SANDBOX_ERROR_EVENT_TYPE,
  classifyToolBoundaryRequest,
  evaluateBoundaryClassification,
  resolveBoundaryPolicy,
  analyzeVirtualReadonlyEligibility,
  summarizeShellCommandAnalysis,
  summarizeVirtualReadonlyEligibility,
  type BrewvaConfig,
  type CommandPolicySummary,
  type ResolvedBoundaryPolicy,
  type ShellCommandAnalysis,
  type VirtualReadonlyEligibility,
} from "@brewva/brewva-runtime";
import type { BrewvaToolDefinition as ToolDefinition } from "@brewva/brewva-substrate";
import { Type } from "@sinclair/typebox";
import {
  deleteManagedSession,
  markSessionBackgrounded,
  startManagedExec,
  terminateRunningSession,
  type ManagedExecFinishedSession,
  type ManagedExecRunningSession,
} from "./exec-process-registry.js";
import {
  recordToolRuntimeEvent,
  resolveToolRuntimeCredentialBindings,
  resolveToolRuntimeSandboxApiKey,
} from "./runtime-internal.js";
import { isPathInsideRoots, resolveToolTargetScope } from "./target-scope.js";
import type { BrewvaBundledToolRuntime } from "./types.js";
import { textResult, withVerdict } from "./utils/result.js";
import { createRuntimeBoundBrewvaToolFactory } from "./utils/runtime-bound-tool.js";
import { getSessionId } from "./utils/session.js";

const ExecSchema = Type.Object({
  command: Type.String({ minLength: 1 }),
  workdir: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  yieldMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 120_000 })),
  background: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 7_200_000 })),
});

const DEFAULT_YIELD_MS = 10_000;
const MAX_TIMEOUT_SEC = 7_200;
const MAX_TIMEOUT_MS = MAX_TIMEOUT_SEC * 1_000;
const SHELL_COMMAND = "sh";
const SHELL_ARGS = ["-lc"];
const DEFAULT_SANDBOX_WORKDIR = "/";
const SANDBOX_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_AUDIT_COMMAND_PREVIEW_LENGTH = 240;
const SANDBOX_FAILURE_BACKOFF_MS = 60_000;
const SANDBOX_SESSION_PIN_TTL_MS = 15 * 60_000;
const SANDBOX_SESSION_PIN_FAILURE_THRESHOLD = 2;
const VIRTUAL_READONLY_OUTPUT_LIMIT_BYTES = 4_000_000;
const VIRTUAL_READONLY_DEFAULT_TIMEOUT_SEC = 30;
const VIRTUAL_READONLY_MAX_MATERIALIZED_BYTES = 128_000_000;
const VIRTUAL_READONLY_MAX_MATERIALIZED_ENTRIES = 20_000;
const VIRTUAL_READONLY_TEMP_PREFIX = "brewva-vro-";
const VIRTUAL_READONLY_ENV_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DENY_LIST_BEST_EFFORT_MESSAGE =
  "security.boundaryPolicy.commandDenyList is best-effort and must not be treated as a complete shell security boundary.";
const TOOL_NAME_COMMAND_HINTS = new Set(["session_compact"]);

type SecurityMode = BrewvaConfig["security"]["mode"];
type ExecutionBackend = BrewvaConfig["security"]["execution"]["backend"];
type SandboxConfig = BrewvaConfig["security"]["execution"]["sandbox"] & { apiKey?: string };
type MicrosandboxSdk = Pick<typeof import("microsandbox"), "NodeSandbox">;

type RecordedExecEvent =
  | typeof EXEC_ROUTED_EVENT_TYPE
  | typeof EXEC_FALLBACK_HOST_EVENT_TYPE
  | typeof EXEC_BLOCKED_ISOLATION_EVENT_TYPE
  | typeof EXEC_SANDBOX_ERROR_EVENT_TYPE;

interface ResolvedExecutionPolicy {
  mode: SecurityMode;
  configuredBackend: ExecutionBackend;
  backend: "host" | "sandbox";
  routingPolicy: "best_available" | "fail_closed";
  enforceIsolation: boolean;
  allowHostFallback: boolean;
  denyListBestEffort: true;
  commandDenyList: Set<string>;
  boundaryPolicy: ResolvedBoundaryPolicy;
  sandbox: SandboxConfig;
}

interface ExecToolOptions {
  runtime?: BrewvaBundledToolRuntime;
}

interface SandboxCommandBuildResult {
  shellCommand: string;
  requestedCwd?: string;
  effectiveCwd?: string;
  requestedEnvKeys: string[];
  appliedEnvKeys: string[];
  droppedEnvKeys: string[];
}

interface SandboxExecutionResult {
  output: string;
  exitCode: number;
  requestedCwd?: string;
  effectiveCwd: string;
  requestedEnvKeys: string[];
  appliedEnvKeys: string[];
  droppedEnvKeys: string[];
  timeoutSec: number;
}

interface RequestedEnvResolution {
  env?: Record<string, string>;
  requestedKeys: string[];
  userRequestedKeys: string[];
  boundEnvKeys: string[];
  appliedKeys: string[];
  droppedKeys: string[];
}

interface VirtualReadonlyWorkspace {
  executionCwd: string;
  materializedPaths: string[];
  materializedBytes: number;
  materializedEntries: number;
  cleanup(): Promise<void>;
}

interface VirtualReadonlyMaterializationPlan {
  candidates: string[];
}

let microsandboxSdkPromise: Promise<MicrosandboxSdk> | null = null;
const sandboxBackoffUntilByTarget = new Map<string, number>();
const sandboxSessionFailureCount = new Map<string, number>();
const sandboxSessionPinnedUntil = new Map<string, number>();

class SandboxCommandFailedError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "SandboxCommandFailedError";
    this.exitCode = exitCode;
  }
}

class SandboxAbortedError extends Error {
  constructor() {
    super("Execution aborted by signal.");
    this.name = "SandboxAbortedError";
  }
}

class VirtualReadonlyMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VirtualReadonlyMaterializationError";
    this.code = code;
  }
}

function normalizeCommand(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const command = value.trim();
  return command.length > 0 ? command : undefined;
}

function resolveWorkdir(baseCwd: string, value: unknown): string {
  if (typeof value !== "string") return baseCwd;
  const trimmed = value.trim();
  if (!trimmed) return baseCwd;
  return resolve(baseCwd, trimmed);
}

function resolveYieldMs(params: { yieldMs?: unknown }): number {
  const raw = params.yieldMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_YIELD_MS;
  return Math.max(0, Math.min(120_000, Math.trunc(raw)));
}

function resolveTimeoutSec(params: { timeout?: unknown }): number | undefined {
  const clampSeconds = (seconds: number): number => Math.max(1, Math.min(MAX_TIMEOUT_SEC, seconds));

  const timeout = params.timeout;
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return undefined;
  }

  // Values above 1000 are treated as milliseconds. Smaller values remain seconds.
  if (timeout > 1_000) {
    const normalizedMs = Math.max(1, Math.min(MAX_TIMEOUT_MS, timeout));
    return clampSeconds(normalizedMs / 1_000);
  }

  return clampSeconds(timeout);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isSafeEnvKey(key: string): boolean {
  return VALID_ENV_KEY.test(key) && !DANGEROUS_OBJECT_KEYS.has(key);
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function resolveRequestedEnv(input: {
  userEnv?: Record<string, string>;
  boundEnv: Record<string, string>;
}): RequestedEnvResolution {
  const env = Object.create(null) as Record<string, string>;
  const requestedKeys: string[] = [];
  const userRequestedKeys: string[] = [];
  const boundEnvKeys: string[] = [];
  const appliedKeys: string[] = [];
  const droppedKeys: string[] = [];

  const applyEntries = (entries: Iterable<[string, unknown]>, source: "user" | "bound") => {
    for (const [key, value] of entries) {
      requestedKeys.push(key);
      if (source === "user") {
        userRequestedKeys.push(key);
      } else {
        boundEnvKeys.push(key);
      }
      if (!isSafeEnvKey(key) || typeof value !== "string") {
        droppedKeys.push(key);
        continue;
      }
      env[key] = value;
      appliedKeys.push(key);
    }
  };

  applyEntries(Object.entries(input.userEnv ?? {}), "user");
  applyEntries(Object.entries(input.boundEnv), "bound");

  const uniqueAppliedKeys = uniqueKeys(appliedKeys);
  return {
    env: uniqueAppliedKeys.length > 0 ? env : undefined,
    requestedKeys: uniqueKeys(requestedKeys),
    userRequestedKeys: uniqueKeys(userRequestedKeys),
    boundEnvKeys: uniqueKeys(boundEnvKeys),
    appliedKeys: uniqueAppliedKeys,
    droppedKeys: uniqueKeys(droppedKeys),
  };
}

function buildHostEnv(requestedEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env = Object.create(null) as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (isSafeEnvKey(key) && typeof value === "string") {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(requestedEnv ?? {})) {
    if (isSafeEnvKey(key)) {
      env[key] = value;
    }
  }
  return env;
}

function buildVirtualReadonlyEnv(): NodeJS.ProcessEnv {
  const env = Object.create(null) as NodeJS.ProcessEnv;
  env.PATH = VIRTUAL_READONLY_ENV_PATH;
  env.HOME = tmpdir();
  env.LANG = "C";
  env.LC_ALL = "C";
  env.NO_COLOR = "1";
  return env;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveMisroutedToolName(primaryTokens: string[]): string | undefined {
  return primaryTokens.find((token) => TOOL_NAME_COMMAND_HINTS.has(token));
}

function formatExit(session: ManagedExecFinishedSession): string {
  if (session.exitSignal) return `signal ${session.exitSignal}`;
  return `code ${session.exitCode ?? 0}`;
}

function execDisplayResult(text: string, details: Record<string, unknown>) {
  return textResult(text, details, {
    detailsText: text,
    rawText: text,
  });
}

function runningResult(session: ManagedExecRunningSession) {
  const lines = [
    `Command still running (session ${session.id}, pid ${session.pid ?? "n/a"}).`,
    "Use process (list/poll/log/write/kill/clear/remove) for follow-up.",
  ];
  if (session.tail.trim().length > 0) {
    lines.push("", session.tail.trimEnd());
  }
  return execDisplayResult(lines.join("\n"), {
    status: "running",
    verdict: "inconclusive",
    sessionId: session.id,
    pid: session.pid ?? undefined,
    startedAt: session.startedAt,
    cwd: session.cwd,
    tail: session.tail,
    command: session.command,
    backend: "host",
  });
}

async function waitForCompletionOrYield(
  completion: Promise<ManagedExecFinishedSession>,
  yieldMs: number,
): Promise<ManagedExecFinishedSession | undefined> {
  if (yieldMs === 0) return undefined;
  const timerTag = Symbol("yield");
  let yieldTimer: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    completion,
    new Promise<symbol>((resolveNow) => {
      yieldTimer = setTimeout(() => resolveNow(timerTag), yieldMs);
    }),
  ]);
  if (winner !== timerTag && yieldTimer !== undefined) {
    clearTimeout(yieldTimer);
  }
  if (winner === timerTag) return undefined;
  return winner as ManagedExecFinishedSession;
}

function resolveExecutionPolicy(
  runtime?: BrewvaBundledToolRuntime,
  sandboxApiKeyOverride?: string,
): ResolvedExecutionPolicy {
  const security = runtime?.config?.security ?? DEFAULT_BREWVA_CONFIG.security;
  const execution = security.execution;
  const boundaryPolicy = resolveBoundaryPolicy(security as BrewvaConfig["security"]);
  const enforceIsolation =
    execution.enforceIsolation || isTruthyEnvFlag(process.env.BREWVA_ENFORCE_EXEC_ISOLATION);
  const configuredBackend = execution.backend;
  const backend = resolvePreferredBackend({
    mode: security.mode,
    configuredBackend,
    enforceIsolation,
  });
  const allowHostFallback =
    backend === "sandbox" &&
    !enforceIsolation &&
    security.mode !== "strict" &&
    execution.fallbackToHost;

  return {
    mode: security.mode,
    configuredBackend,
    backend,
    routingPolicy: allowHostFallback || backend === "host" ? "best_available" : "fail_closed",
    enforceIsolation,
    allowHostFallback,
    denyListBestEffort: true,
    commandDenyList: boundaryPolicy.commandDenyList,
    boundaryPolicy,
    sandbox: {
      ...execution.sandbox,
      serverUrl: normalizeOptionalString(process.env.MSB_SERVER_URL) ?? execution.sandbox.serverUrl,
      apiKey: sandboxApiKeyOverride,
    },
  };
}

function resolvePreferredBackend(input: {
  mode: SecurityMode;
  configuredBackend: ExecutionBackend;
  enforceIsolation: boolean;
}): "host" | "sandbox" {
  if (input.enforceIsolation || input.mode === "strict") {
    return "sandbox";
  }
  if (input.configuredBackend === "host" || input.configuredBackend === "sandbox") {
    return input.configuredBackend;
  }
  return "sandbox";
}

function resolveSandboxBackoffKey(policy: ResolvedExecutionPolicy): string {
  const serverUrl = normalizeOptionalString(policy.sandbox.serverUrl) ?? "(default-server)";
  const image = normalizeOptionalString(policy.sandbox.defaultImage) ?? "(default-image)";
  return `${serverUrl}|${image}`;
}

function getSandboxBackoffUntil(policy: ResolvedExecutionPolicy): number | null {
  const key = resolveSandboxBackoffKey(policy);
  const backoffUntil = sandboxBackoffUntilByTarget.get(key);
  if (typeof backoffUntil !== "number" || !Number.isFinite(backoffUntil)) {
    sandboxBackoffUntilByTarget.delete(key);
    return null;
  }
  return backoffUntil;
}

function getRemainingSandboxBackoffMs(policy: ResolvedExecutionPolicy, now: number): number {
  const backoffUntil = getSandboxBackoffUntil(policy);
  if (backoffUntil === null) return 0;
  const remaining = backoffUntil - now;
  if (remaining <= 0) {
    sandboxBackoffUntilByTarget.delete(resolveSandboxBackoffKey(policy));
    return 0;
  }
  return remaining;
}

function markSandboxBackoff(policy: ResolvedExecutionPolicy, now: number): number {
  const backoffUntil = now + SANDBOX_FAILURE_BACKOFF_MS;
  sandboxBackoffUntilByTarget.set(resolveSandboxBackoffKey(policy), backoffUntil);
  return backoffUntil;
}

function clearSandboxBackoff(policy: ResolvedExecutionPolicy): void {
  sandboxBackoffUntilByTarget.delete(resolveSandboxBackoffKey(policy));
}

function getSandboxSessionPinRemainingMs(sessionId: string, now: number): number {
  const pinnedUntil = sandboxSessionPinnedUntil.get(sessionId);
  if (typeof pinnedUntil !== "number" || !Number.isFinite(pinnedUntil)) {
    sandboxSessionPinnedUntil.delete(sessionId);
    return 0;
  }
  const remaining = pinnedUntil - now;
  if (remaining <= 0) {
    sandboxSessionPinnedUntil.delete(sessionId);
    sandboxSessionFailureCount.delete(sessionId);
    return 0;
  }
  return remaining;
}

function noteSandboxSessionFailure(
  sessionId: string,
  now: number,
): { pinned: boolean; until?: number } {
  const failures = (sandboxSessionFailureCount.get(sessionId) ?? 0) + 1;
  sandboxSessionFailureCount.set(sessionId, failures);
  if (failures < SANDBOX_SESSION_PIN_FAILURE_THRESHOLD) {
    return { pinned: false };
  }
  const until = now + SANDBOX_SESSION_PIN_TTL_MS;
  sandboxSessionPinnedUntil.set(sessionId, until);
  return { pinned: true, until };
}

function clearSandboxSessionFailureState(sessionId: string): void {
  sandboxSessionFailureCount.delete(sessionId);
  sandboxSessionPinnedUntil.delete(sessionId);
}

function redactCommandForAudit(command: string): string {
  const redacted = command
    .replace(
      /\b(authorization\s*[:=]\s*bearer\s+)[^\s"'`]+/giu,
      (_match, prefix: string) => `${prefix}<redacted>`,
    )
    .replace(/\b(Bearer\s+)[^\s"'`]+/gu, (_match, prefix: string) => `${prefix}<redacted>`)
    .replace(
      /\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)(['"]?)[^'"\s]+(\2)/giu,
      (_match, prefix: string, quote: string) => `${prefix}${quote}<redacted>${quote}`,
    )
    .replace(
      /\b(x-api-key\s*[:=]\s*)(['"]?)[^'"\s]+(\2)/giu,
      (_match, prefix: string, quote: string) => `${prefix}${quote}<redacted>${quote}`,
    )
    .replace(
      /(-{1,2}(?:password|token|secret|api-key)\s+)([^\s"'`]+)/giu,
      (_match, prefix: string) => `${prefix}<redacted>`,
    );

  if (redacted.length <= DEFAULT_AUDIT_COMMAND_PREVIEW_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, DEFAULT_AUDIT_COMMAND_PREVIEW_LENGTH)}...`;
}

function redactTextForAudit(value: string): string {
  return redactCommandForAudit(value);
}

function hashCommandForAudit(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

function buildCommandAuditPayload(command: string): Record<string, unknown> {
  return {
    commandHash: hashCommandForAudit(command),
    commandRedacted: redactCommandForAudit(command),
  };
}

function buildCommandPolicyAuditPayload(commandPolicy: ShellCommandAnalysis | undefined): {
  commandPolicy?: CommandPolicySummary;
} {
  return commandPolicy ? { commandPolicy: summarizeShellCommandAnalysis(commandPolicy) } : {};
}

function buildVirtualReadonlyAuditPayload(
  virtualReadonly: VirtualReadonlyEligibility | undefined,
): {
  virtualReadonly?: ReturnType<typeof summarizeVirtualReadonlyEligibility>;
} {
  return virtualReadonly
    ? { virtualReadonly: summarizeVirtualReadonlyEligibility(virtualReadonly) }
    : {};
}

async function loadMicrosandboxSdk(): Promise<MicrosandboxSdk> {
  if (!microsandboxSdkPromise) {
    microsandboxSdkPromise = import("microsandbox")
      .then((sdk) => ({
        NodeSandbox: sdk.NodeSandbox,
      }))
      .catch((error) => {
        microsandboxSdkPromise = null;
        throw error;
      });
  }
  return await microsandboxSdkPromise;
}

function buildExecAuditPayload(input: {
  toolCallId: string;
  policy: ResolvedExecutionPolicy;
  command: string;
  payload?: object;
}): Record<string, unknown> {
  return {
    toolCallId: input.toolCallId,
    mode: input.policy.mode,
    routingPolicy: input.policy.routingPolicy,
    configuredBackend: input.policy.configuredBackend,
    enforceIsolation: input.policy.enforceIsolation,
    denyListBestEffort: input.policy.denyListBestEffort,
    ...buildCommandAuditPayload(input.command),
    ...input.payload,
  };
}

function isSandboxAbortedError(error: unknown): error is SandboxAbortedError {
  return error instanceof SandboxAbortedError;
}

function escapeForSingleQuotedShell(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function buildSandboxCommand(input: {
  command: string;
  requestedCwd?: string;
  requestedEnv?: Record<string, string>;
}): SandboxCommandBuildResult {
  const requestedEnvEntries = Object.entries(input.requestedEnv ?? {});
  const requestedEnvKeys = requestedEnvEntries.map(([key]) => key);
  const appliedEnvEntries = requestedEnvEntries.filter(([key]) => isSafeEnvKey(key));
  const appliedEnvKeys = appliedEnvEntries.map(([key]) => key);
  const droppedEnvKeys = requestedEnvEntries
    .map(([key]) => key)
    .filter((key) => !VALID_ENV_KEY.test(key));

  const prefixClauses: string[] = [];
  if (input.requestedCwd) {
    prefixClauses.push(`cd ${escapeForSingleQuotedShell(input.requestedCwd)}`);
  }
  for (const [key, value] of appliedEnvEntries) {
    prefixClauses.push(`export ${key}=${escapeForSingleQuotedShell(value)}`);
  }

  // security-pattern-allow direct-shell-command-concat: cwd/env prefixes are escaped; command body remains policy-governed and receipt-bound.
  const shellCommand =
    prefixClauses.length > 0 ? `${prefixClauses.join(" && ")} && ${input.command}` : input.command;
  return {
    shellCommand,
    requestedCwd: input.requestedCwd,
    effectiveCwd: input.requestedCwd ?? DEFAULT_SANDBOX_WORKDIR,
    requestedEnvKeys,
    appliedEnvKeys,
    droppedEnvKeys,
  };
}

function recordExecEvent(
  runtime: BrewvaBundledToolRuntime | undefined,
  sessionId: string,
  type: RecordedExecEvent,
  payload: Record<string, unknown>,
): void {
  recordToolRuntimeEvent(runtime, {
    sessionId,
    type,
    payload,
  });
}

async function executeHostCommand(input: {
  ownerSessionId: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutSec?: number;
  background: boolean;
  yieldMs: number;
  signal?: AbortSignal;
}) {
  let started;
  try {
    started = startManagedExec({
      ownerSessionId: input.ownerSessionId,
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      timeoutSec: input.timeoutSec,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(
      `Exec failed to start: ${message}`,
      withVerdict(
        {
          status: "failed",
          command: input.command,
          cwd: input.cwd,
          backend: "host",
        },
        "fail",
      ),
    );
  }

  const onAbort = () => {
    if (input.background || started.session.backgrounded) return;
    terminateRunningSession(started.session, true);
  };

  if (input.signal?.aborted) {
    onAbort();
  } else if (input.signal) {
    input.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    if (input.background || input.yieldMs === 0) {
      markSessionBackgrounded(input.ownerSessionId, started.session.id);
      return runningResult(started.session);
    }

    const finished = await waitForCompletionOrYield(started.completion, input.yieldMs);
    if (!finished) {
      markSessionBackgrounded(input.ownerSessionId, started.session.id);
      return runningResult(started.session);
    }

    if (!finished.backgrounded) {
      deleteManagedSession(input.ownerSessionId, finished.id);
    }

    const output = finished.aggregated.trimEnd() || "(no output)";
    if (finished.status === "completed") {
      return execDisplayResult(output, {
        status: "completed",
        exitCode: finished.exitCode ?? 0,
        durationMs: finished.endedAt - finished.startedAt,
        cwd: finished.cwd,
        command: finished.command,
        backend: "host",
      });
    }

    throw new Error(`${output}\n\nProcess exited with ${formatExit(finished)}.`);
  } finally {
    if (input.signal) {
      input.signal.removeEventListener("abort", onAbort);
    }
  }
}

function isPathInsideRoot(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function buildVirtualReadonlyMaterializationPlan(
  virtualReadonly: VirtualReadonlyEligibility,
): VirtualReadonlyMaterializationPlan {
  if (!virtualReadonly.eligible) {
    const blocked = virtualReadonly.blockedReasons[0];
    throw new VirtualReadonlyMaterializationError(
      blocked?.code ?? "virtual_readonly_not_eligible",
      blocked?.detail ?? "Virtual readonly route is not eligible for this command.",
    );
  }

  return { candidates: [...virtualReadonly.materializedCandidates] };
}

async function copyPathIntoVirtualWorkspace(input: {
  sourcePath: string;
  destinationPath: string;
  sourceRoot: string;
  counters: { bytes: number; entries: number };
}): Promise<void> {
  input.counters.entries += 1;
  if (input.counters.entries > VIRTUAL_READONLY_MAX_MATERIALIZED_ENTRIES) {
    throw new VirtualReadonlyMaterializationError(
      "virtual_readonly_entry_limit",
      `Virtual readonly materialization exceeded ${VIRTUAL_READONLY_MAX_MATERIALIZED_ENTRIES} entries.`,
    );
  }

  const sourceStat = await lstat(input.sourcePath);
  if (sourceStat.isSymbolicLink()) {
    const target = resolve(dirname(input.sourcePath), await readlink(input.sourcePath));
    const realTarget = await realpath(target);
    if (!isPathInsideRoot(realTarget, input.sourceRoot)) {
      throw new VirtualReadonlyMaterializationError(
        "virtual_readonly_symlink_escape",
        `Virtual readonly refused symlink outside target root: ${input.sourcePath}`,
      );
    }
    await copyPathIntoVirtualWorkspace({
      sourcePath: realTarget,
      destinationPath: input.destinationPath,
      sourceRoot: input.sourceRoot,
      counters: input.counters,
    });
    return;
  }

  if (sourceStat.isDirectory()) {
    await mkdir(input.destinationPath, { recursive: true });
    const entries = await readdir(input.sourcePath);
    for (const entry of entries) {
      await copyPathIntoVirtualWorkspace({
        sourcePath: join(input.sourcePath, entry),
        destinationPath: join(input.destinationPath, entry),
        sourceRoot: input.sourceRoot,
        counters: input.counters,
      });
    }
    return;
  }

  if (!sourceStat.isFile()) {
    throw new VirtualReadonlyMaterializationError(
      "virtual_readonly_special_file",
      `Virtual readonly refused special file: ${input.sourcePath}`,
    );
  }

  input.counters.bytes += sourceStat.size;
  if (input.counters.bytes > VIRTUAL_READONLY_MAX_MATERIALIZED_BYTES) {
    throw new VirtualReadonlyMaterializationError(
      "virtual_readonly_size_limit",
      `Virtual readonly materialization exceeded ${VIRTUAL_READONLY_MAX_MATERIALIZED_BYTES} bytes.`,
    );
  }

  await mkdir(dirname(input.destinationPath), { recursive: true });
  await copyFile(input.sourcePath, input.destinationPath);
}

async function createVirtualReadonlyWorkspace(
  sourceCwd: string,
  plan: VirtualReadonlyMaterializationPlan,
): Promise<VirtualReadonlyWorkspace> {
  const executionCwd = await mkdtemp(join(tmpdir(), VIRTUAL_READONLY_TEMP_PREFIX));
  const counters = { bytes: 0, entries: 0 };
  const materializedPaths: string[] = [];

  try {
    for (const candidate of plan.candidates) {
      const sourcePath = resolve(sourceCwd, candidate);
      if (!isPathInsideRoot(sourcePath, sourceCwd)) {
        throw new VirtualReadonlyMaterializationError(
          "virtual_readonly_path_escape",
          `Virtual readonly path escapes target root: ${candidate}`,
        );
      }

      try {
        await stat(sourcePath);
      } catch {
        continue;
      }

      await copyPathIntoVirtualWorkspace({
        sourcePath,
        destinationPath: join(executionCwd, candidate),
        sourceRoot: sourceCwd,
        counters,
      });
      materializedPaths.push(candidate);
    }

    return {
      executionCwd,
      materializedPaths,
      materializedBytes: counters.bytes,
      materializedEntries: counters.entries,
      async cleanup() {
        await rm(executionCwd, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await rm(executionCwd, { force: true, recursive: true });
    throw error;
  }
}

async function executeVirtualReadonlyCommand(input: {
  command: string;
  commandPolicy: ShellCommandAnalysis;
  virtualReadonly: VirtualReadonlyEligibility;
  cwd: string;
  timeoutSec?: number;
  signal?: AbortSignal;
}) {
  if (input.signal?.aborted) {
    throw new SandboxAbortedError();
  }

  const materializationPlan = buildVirtualReadonlyMaterializationPlan(input.virtualReadonly);
  const workspace = await createVirtualReadonlyWorkspace(input.cwd, materializationPlan);
  const startedAt = Date.now();
  const commandPolicy = summarizeShellCommandAnalysis(input.commandPolicy);
  const virtualReadonly = summarizeVirtualReadonlyEligibility(input.virtualReadonly);

  try {
    return await new Promise<ReturnType<typeof textResult>>((resolveResult, rejectResult) => {
      const child = spawn(SHELL_COMMAND, [...SHELL_ARGS, input.command], {
        cwd: workspace.executionCwd,
        env: buildVirtualReadonlyEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      let aggregated = "";
      let truncated = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        if (input.signal) {
          input.signal.removeEventListener("abort", abortExecution);
        }
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const append = (chunk: Buffer) => {
        if (aggregated.length >= VIRTUAL_READONLY_OUTPUT_LIMIT_BYTES) {
          truncated = true;
          child.kill("SIGTERM");
          return;
        }
        const next = chunk.toString("utf8");
        const remaining = VIRTUAL_READONLY_OUTPUT_LIMIT_BYTES - aggregated.length;
        if (next.length > remaining) {
          aggregated += next.slice(0, remaining);
          truncated = true;
          child.kill("SIGTERM");
          return;
        }
        aggregated += next;
      };

      function abortExecution() {
        child.kill("SIGTERM");
        settle(() => rejectResult(new SandboxAbortedError()));
      }

      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.on("error", (error) => {
        settle(() => rejectResult(error));
      });
      child.on("close", (exitCode, exitSignal) => {
        settle(() => {
          const output = aggregated.trimEnd() || "(no output)";
          if (exitCode === 0) {
            resolveResult(
              execDisplayResult(output, {
                status: "completed",
                exitCode,
                durationMs: Date.now() - startedAt,
                cwd: input.cwd,
                command: input.command,
                backend: "virtual_readonly",
                evidenceKind: "exploration",
                verificationEvidence: false,
                outputTruncated: truncated,
                isolation: "materialized_workspace_subset",
                materializedPaths: workspace.materializedPaths,
                materializedBytes: workspace.materializedBytes,
                materializedEntries: workspace.materializedEntries,
                commandPolicy,
                virtualReadonly,
              }),
            );
            return;
          }

          const exit = exitSignal ? `signal ${exitSignal}` : `code ${exitCode ?? 1}`;
          rejectResult(new Error(`${output}\n\nProcess exited with ${exit}.`));
        });
      });

      const timeoutSec = input.timeoutSec ?? VIRTUAL_READONLY_DEFAULT_TIMEOUT_SEC;
      if (timeoutSec) {
        timeoutHandle = setTimeout(() => {
          child.kill("SIGTERM");
          settle(() =>
            rejectResult(
              new SandboxCommandFailedError(
                `Virtual readonly command timed out after ${timeoutSec} seconds.`,
                124,
              ),
            ),
          );
        }, timeoutSec * 1_000);
      }

      if (input.signal) {
        input.signal.addEventListener("abort", abortExecution, { once: true });
      }
    });
  } finally {
    await workspace.cleanup();
  }
}

async function executeSandboxCommand(input: {
  command: string;
  policy: ResolvedExecutionPolicy;
  requestedCwd?: string;
  requestedEnv?: Record<string, string>;
  requestedTimeoutSec?: number;
  signal?: AbortSignal;
}): Promise<SandboxExecutionResult> {
  if (input.signal?.aborted) {
    throw new SandboxAbortedError();
  }

  const sdk = await loadMicrosandboxSdk();
  const sandboxCommand = buildSandboxCommand({
    command: input.command,
    requestedCwd: input.requestedCwd,
    requestedEnv: input.requestedEnv,
  });
  const timeoutSec = input.requestedTimeoutSec ?? input.policy.sandbox.timeout;

  let sandbox: {
    command: {
      run(
        command: string,
        args?: string[],
        timeout?: number,
      ): Promise<{
        output(): Promise<string>;
        error(): Promise<string>;
        exitCode: number;
        success: boolean;
      }>;
    };
    stop(): Promise<void>;
  } | null = null;
  let abortListener: (() => void) | undefined;

  const stopSandbox = async () => {
    if (!sandbox) return;
    const sandboxToStop = sandbox;
    sandbox = null;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sandboxToStop.stop(),
        new Promise<void>((resolveNow) => {
          stopTimer = setTimeout(resolveNow, SANDBOX_STOP_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // ignore stop errors: command outcome should be the primary signal
    } finally {
      if (stopTimer !== undefined) {
        clearTimeout(stopTimer);
      }
    }
  };

  try {
    sandbox = await sdk.NodeSandbox.create({
      name: `brewva-${Date.now().toString(36)}`,
      serverUrl: input.policy.sandbox.serverUrl,
      apiKey: input.policy.sandbox.apiKey,
      image: input.policy.sandbox.defaultImage,
      memory: input.policy.sandbox.memory,
      cpus: input.policy.sandbox.cpus,
      timeout: input.policy.sandbox.timeout,
    });

    if (input.signal?.aborted) {
      throw new SandboxAbortedError();
    }

    const runPromise = sandbox.command.run(
      SHELL_COMMAND,
      [...SHELL_ARGS, sandboxCommand.shellCommand],
      timeoutSec,
    );
    const abortSignal = input.signal;

    let execution: Awaited<typeof runPromise>;
    try {
      execution = await new Promise<Awaited<typeof runPromise>>((resolveRun, rejectRun) => {
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
          }
          if (abortSignal && abortListener) {
            abortSignal.removeEventListener("abort", abortListener);
            abortListener = undefined;
          }
        };

        const resolveOnce = (value: Awaited<typeof runPromise>) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolveRun(value);
        };

        const rejectOnce = (reason: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          rejectRun(reason);
        };

        if (abortSignal) {
          const abortExecution = () => {
            void stopSandbox();
            rejectOnce(new SandboxAbortedError());
          };
          abortListener = abortExecution;

          if (abortSignal.aborted) {
            abortExecution();
            return;
          }

          abortSignal.addEventListener("abort", abortExecution, { once: true });
        }

        timeoutHandle = setTimeout(() => {
          void stopSandbox();
          rejectOnce(
            new SandboxCommandFailedError(`Process timed out after ${timeoutSec} seconds.`, 124),
          );
        }, timeoutSec * 1_000);

        runPromise.then(resolveOnce).catch(rejectOnce);
      });
    } catch (error) {
      if (isSandboxAbortedError(error)) {
        throw error;
      }
      if (error instanceof SandboxCommandFailedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SandboxCommandFailedError(message, -1);
    }

    const stdout = await execution.output();
    const stderr = await execution.error();
    const combined = [stdout.trimEnd(), stderr.trimEnd()]
      .filter((part) => part.length > 0)
      .join("\n");

    if (!execution.success) {
      const errorText = combined.length > 0 ? combined : "(no output)";
      throw new SandboxCommandFailedError(
        `${errorText}\n\nProcess exited with code ${execution.exitCode}.`,
        execution.exitCode,
      );
    }

    return {
      output: combined.length > 0 ? combined : "(no output)",
      exitCode: execution.exitCode,
      requestedCwd: sandboxCommand.requestedCwd,
      effectiveCwd: sandboxCommand.effectiveCwd ?? DEFAULT_SANDBOX_WORKDIR,
      requestedEnvKeys: sandboxCommand.requestedEnvKeys,
      appliedEnvKeys: sandboxCommand.appliedEnvKeys,
      droppedEnvKeys: sandboxCommand.droppedEnvKeys,
      timeoutSec,
    };
  } finally {
    if (input.signal && abortListener) {
      input.signal.removeEventListener("abort", abortListener);
    }
    await stopSandbox();
  }
}

export function createExecTool(options?: ExecToolOptions): ToolDefinition {
  const execTool = createRuntimeBoundBrewvaToolFactory(options?.runtime, "exec");
  const runtime = execTool.runtime;
  return execTool.define(
    {
      name: "exec",
      label: "Exec",
      description:
        "Execute shell commands with optional background continuation. Pair with process tool for list/poll/log/kill.",
      promptSnippet:
        "Run a bounded shell command when real workspace execution or verification is required.",
      promptGuidelines: [
        "Prefer read-only inspection before mutation or long-running execution.",
        "Use explicit workdir and bounded output for broad commands.",
        "After mutating commands, collect verification evidence before concluding.",
      ],
      parameters: ExecSchema,
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        const ownerSessionId = getSessionId(ctx);
        const targetScope = resolveToolTargetScope(runtime, ctx);
        const baseCwd = targetScope.baseCwd;
        const command = normalizeCommand(params.command);
        if (!command) {
          return textResult(
            "Exec rejected (missing_command).",
            withVerdict({ status: "failed" }, "fail"),
          );
        }

        const requestedWorkdir = normalizeOptionalString(params.workdir);
        const hostCwd = resolveWorkdir(baseCwd, requestedWorkdir);
        if (!isPathInsideRoots(hostCwd, targetScope.allowedRoots)) {
          return textResult(
            `Exec rejected (workdir_outside_target): ${hostCwd}`,
            withVerdict(
              {
                status: "failed",
                reason: "workdir_outside_target",
                requestedCwd: hostCwd,
                allowedRoots: targetScope.allowedRoots,
              },
              "fail",
            ),
          );
        }
        const sandboxRequestedCwd = requestedWorkdir ? hostCwd : undefined;
        const boundEnv = resolveToolRuntimeCredentialBindings(runtime, ownerSessionId, "exec");
        const requestedEnv = resolveRequestedEnv({
          userEnv: params.env,
          boundEnv,
        });
        const hostEnv = buildHostEnv(requestedEnv.env);
        const timeoutSec = resolveTimeoutSec(params);
        const background = params.background === true;
        const yieldMs = background ? 0 : resolveYieldMs(params);

        const policy = resolveExecutionPolicy(
          runtime,
          resolveToolRuntimeSandboxApiKey(runtime, ownerSessionId),
        );
        const boundaryClassification = classifyToolBoundaryRequest({
          toolName: "exec",
          args: params as Record<string, unknown>,
          cwd: baseCwd,
          workspaceRoot: runtime?.workspaceRoot,
        });
        const primaryTokens = boundaryClassification.detectedCommands;
        const commandPolicy = boundaryClassification.commandPolicy;
        const virtualReadonly = commandPolicy
          ? analyzeVirtualReadonlyEligibility(commandPolicy)
          : undefined;
        const misroutedToolName = resolveMisroutedToolName(primaryTokens);
        if (misroutedToolName) {
          const reason = `Command '${misroutedToolName}' is a Brewva tool name. Call tool '${misroutedToolName}' directly instead of using exec.`;
          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                detectedCommands: primaryTokens,
                reason,
                blockedAsToolNameMisroute: true,
                suggestedTool: misroutedToolName,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          throw new Error(`exec_blocked_isolation: ${reason}`);
        }

        const boundaryDecision = evaluateBoundaryClassification(
          policy.boundaryPolicy,
          boundaryClassification,
        );
        if (!boundaryDecision.allowed) {
          const deniedCommand = primaryTokens.find((token) => policy.commandDenyList.has(token));
          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                detectedCommands: primaryTokens,
                deniedCommand,
                requestedCwd: boundaryClassification.requestedCwd ?? null,
                targetHosts: boundaryClassification.targetHosts.map((target) => ({
                  host: target.host,
                  port: target.port,
                })),
                reason: boundaryDecision.reason,
                denyListPolicy: deniedCommand ? DENY_LIST_BEST_EFFORT_MESSAGE : undefined,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          throw new Error(`exec_blocked_isolation: ${boundaryDecision.reason}`);
        }

        const preferredBackend = policy.backend;
        if (
          commandPolicy &&
          virtualReadonly?.eligible &&
          requestedEnv.userRequestedKeys.length === 0 &&
          !background
        ) {
          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_ROUTED_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                resolvedBackend: "virtual_readonly",
                fallbackToHost: false,
                requestedCwd: hostCwd,
                requestedEnvKeys: requestedEnv.userRequestedKeys,
                withheldBoundEnvKeys: requestedEnv.boundEnvKeys,
                droppedEnvKeys: requestedEnv.droppedKeys,
                requestedTimeoutSec: timeoutSec,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          try {
            return await executeVirtualReadonlyCommand({
              command,
              commandPolicy,
              virtualReadonly,
              cwd: hostCwd,
              timeoutSec,
              signal,
            });
          } catch (error) {
            if (isSandboxAbortedError(error) || signal?.aborted) {
              throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            const auditError = redactTextForAudit(message);
            recordExecEvent(
              runtime,
              ownerSessionId,
              EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
              buildExecAuditPayload({
                toolCallId,
                policy,
                command,
                payload: {
                  reason: "virtual_readonly_execution_error",
                  blockedFeature:
                    error instanceof VirtualReadonlyMaterializationError ? error.code : undefined,
                  error: auditError,
                  ...buildCommandPolicyAuditPayload(commandPolicy),
                  ...buildVirtualReadonlyAuditPayload(virtualReadonly),
                },
              }),
            );
            throw new Error(`exec_blocked_isolation: ${message}`, { cause: error });
          }
        }

        const runHost = async () =>
          executeHostCommand({
            ownerSessionId,
            command,
            cwd: hostCwd,
            env: hostEnv,
            timeoutSec,
            background,
            yieldMs,
            signal,
          });

        if (preferredBackend === "host") {
          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_ROUTED_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                resolvedBackend: preferredBackend,
                fallbackToHost: policy.allowHostFallback,
                requestedCwd: sandboxRequestedCwd,
                effectiveSandboxCwd: sandboxRequestedCwd ?? DEFAULT_SANDBOX_WORKDIR,
                requestedEnvKeys: requestedEnv.requestedKeys,
                appliedEnvKeys: requestedEnv.appliedKeys,
                droppedEnvKeys: requestedEnv.droppedKeys,
                requestedTimeoutSec: timeoutSec,
                sandboxDefaultTimeoutSec: policy.sandbox.timeout,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          return await runHost();
        }

        if (policy.allowHostFallback) {
          const now = Date.now();
          const sessionPinRemainingMs = getSandboxSessionPinRemainingMs(ownerSessionId, now);
          if (sessionPinRemainingMs > 0) {
            recordExecEvent(
              runtime,
              ownerSessionId,
              EXEC_FALLBACK_HOST_EVENT_TYPE,
              buildExecAuditPayload({
                toolCallId,
                policy,
                command,
                payload: {
                  reason: "sandbox_unavailable_session_pinned",
                  sessionPinMsRemaining: sessionPinRemainingMs,
                  ...buildCommandPolicyAuditPayload(commandPolicy),
                  ...buildVirtualReadonlyAuditPayload(virtualReadonly),
                },
              }),
            );
            return await runHost();
          }
          const backoffMsRemaining = getRemainingSandboxBackoffMs(policy, now);
          if (backoffMsRemaining > 0) {
            recordExecEvent(
              runtime,
              ownerSessionId,
              EXEC_FALLBACK_HOST_EVENT_TYPE,
              buildExecAuditPayload({
                toolCallId,
                policy,
                command,
                payload: {
                  reason: "sandbox_unavailable_cached",
                  backoffMsRemaining,
                  ...buildCommandPolicyAuditPayload(commandPolicy),
                  ...buildVirtualReadonlyAuditPayload(virtualReadonly),
                },
              }),
            );
            return await runHost();
          }
        }

        recordExecEvent(
          runtime,
          ownerSessionId,
          EXEC_ROUTED_EVENT_TYPE,
          buildExecAuditPayload({
            toolCallId,
            policy,
            command,
            payload: {
              resolvedBackend: preferredBackend,
              fallbackToHost: policy.allowHostFallback,
              requestedCwd: sandboxRequestedCwd,
              effectiveSandboxCwd: sandboxRequestedCwd ?? DEFAULT_SANDBOX_WORKDIR,
              requestedEnvKeys: requestedEnv.requestedKeys,
              appliedEnvKeys: requestedEnv.appliedKeys,
              droppedEnvKeys: requestedEnv.droppedKeys,
              requestedTimeoutSec: timeoutSec,
              sandboxDefaultTimeoutSec: policy.sandbox.timeout,
              ...buildCommandPolicyAuditPayload(commandPolicy),
              ...buildVirtualReadonlyAuditPayload(virtualReadonly),
            },
          }),
        );

        if (background) {
          const reason = "sandbox backend does not support background process mode";
          if (policy.allowHostFallback) {
            recordExecEvent(
              runtime,
              ownerSessionId,
              EXEC_FALLBACK_HOST_EVENT_TYPE,
              buildExecAuditPayload({
                toolCallId,
                policy,
                command,
                payload: {
                  reason,
                  ...buildCommandPolicyAuditPayload(commandPolicy),
                  ...buildVirtualReadonlyAuditPayload(virtualReadonly),
                },
              }),
            );
            return await runHost();
          }

          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                reason,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          throw new Error(`exec_blocked_isolation: ${reason}`);
        }

        try {
          const startedAt = Date.now();
          const result = await executeSandboxCommand({
            command,
            policy,
            requestedCwd: sandboxRequestedCwd,
            requestedEnv: requestedEnv.env,
            requestedTimeoutSec: timeoutSec,
            signal,
          });
          clearSandboxBackoff(policy);
          clearSandboxSessionFailureState(ownerSessionId);
          return execDisplayResult(result.output, {
            status: "completed",
            exitCode: result.exitCode,
            durationMs: Date.now() - startedAt,
            cwd: result.effectiveCwd,
            command,
            backend: "sandbox",
            requestedCwd: result.requestedCwd,
            requestedEnvKeys: result.requestedEnvKeys,
            appliedEnvKeys: result.appliedEnvKeys,
            droppedEnvKeys: result.droppedEnvKeys,
            timeoutSec: result.timeoutSec,
            commandPolicy: commandPolicy ? summarizeShellCommandAnalysis(commandPolicy) : undefined,
            virtualReadonly: virtualReadonly
              ? summarizeVirtualReadonlyEligibility(virtualReadonly)
              : undefined,
          });
        } catch (error) {
          if (error instanceof SandboxCommandFailedError) {
            throw new Error(error.message, { cause: error });
          }
          if (isSandboxAbortedError(error) || signal?.aborted) {
            throw error;
          }

          const message = error instanceof Error ? error.message : String(error);
          const auditError = redactTextForAudit(message);
          const now = Date.now();
          const backoffUntil = policy.allowHostFallback ? markSandboxBackoff(policy, now) : null;
          const sessionPin = policy.allowHostFallback
            ? noteSandboxSessionFailure(ownerSessionId, now)
            : { pinned: false };
          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_SANDBOX_ERROR_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                error: auditError,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );

          if (policy.allowHostFallback) {
            recordExecEvent(
              runtime,
              ownerSessionId,
              EXEC_FALLBACK_HOST_EVENT_TYPE,
              buildExecAuditPayload({
                toolCallId,
                policy,
                command,
                payload: {
                  reason: "sandbox_execution_error",
                  error: auditError,
                  backoffMs: SANDBOX_FAILURE_BACKOFF_MS,
                  backoffUntil,
                  sessionPinnedUntil: sessionPin.until,
                  sessionPinTtlMs:
                    sessionPin.pinned && typeof sessionPin.until === "number"
                      ? Math.max(0, sessionPin.until - now)
                      : undefined,
                  ...buildCommandPolicyAuditPayload(commandPolicy),
                  ...buildVirtualReadonlyAuditPayload(virtualReadonly),
                },
              }),
            );
            return await runHost();
          }

          recordExecEvent(
            runtime,
            ownerSessionId,
            EXEC_BLOCKED_ISOLATION_EVENT_TYPE,
            buildExecAuditPayload({
              toolCallId,
              policy,
              command,
              payload: {
                reason: "sandbox_execution_error",
                error: auditError,
                ...buildCommandPolicyAuditPayload(commandPolicy),
                ...buildVirtualReadonlyAuditPayload(virtualReadonly),
              },
            }),
          );
          throw new Error(`exec_blocked_isolation: ${message}`, { cause: error });
        }
      },
    },
    {
      requiredCapabilities: [
        "inspect.task.getTargetDescriptor",
        "internal.recordEvent",
        "internal.resolveCredentialBindings",
        "internal.resolveSandboxApiKey",
      ],
    },
  );
}
