import { createOperatorRuntimePort } from "@brewva/brewva-runtime";
import type { BrewvaPromptSessionEvent } from "@brewva/brewva-substrate";
import {
  createKeybindingResolver,
  type KeybindingContext,
  type OverlayPriority,
} from "@brewva/brewva-tui";
import {
  getExternalPagerCommand,
  openExternalEditorWithShell,
  openExternalPagerWithShell,
} from "../external-process.js";
import { formatInspectAnalysisText } from "../inspect-analysis.js";
import { buildSessionInspectReport, resolveInspectDirectory } from "../inspect.js";
import {
  extractMessageError,
  extractVisibleTextFromMessage,
  readMessageRole,
  readMessageStopReason,
} from "../message-content.js";
import {
  createOperatorSurfacePort,
  createSessionViewPort,
  createShellConfigPort,
  createWorkspaceCompletionPort,
} from "./adapters/ports.js";
import {
  createCliShellState,
  reduceCliShellState,
  type CliShellAction,
  type CliShellState,
  type CliShellTranscriptEntry,
} from "./state/index.js";
import {
  buildTaskRunListLabel,
  buildTaskRunOutputLines,
  buildTaskRunPreviewLines,
} from "./task-details.js";
import { renderTranscriptEntryBodyLines, measureTranscriptEntryLines } from "./transcript.js";
import type {
  CliOverlaySection,
  CliNotificationsOverlayPayload,
  CliShellOverlayPayload,
  CliShellSessionBundle,
  CliShellUiPort,
  OperatorSurfaceSnapshot,
  SessionViewPort,
} from "./types.js";
import { createCliShellUiPortController } from "./ui-port.js";

export interface CliShellControllerOptions {
  cwd: string;
  verbose?: boolean;
  initialMessage?: string;
  openSession(sessionId: string): Promise<CliShellSessionBundle>;
  createSession(): Promise<CliShellSessionBundle>;
  onBundleChange?(bundle: CliShellSessionBundle): void;
  openExternalEditor?(title: string, prefill?: string): Promise<string | undefined>;
  openExternalPager?(title: string, lines: readonly string[]): Promise<boolean>;
  operatorPollIntervalMs?: number;
}

export interface CliShellSemanticInput {
  key: string;
  text?: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function transcriptRole(role: string | undefined): CliShellTranscriptEntry["role"] {
  switch (role) {
    case "assistant":
      return "assistant";
    case "user":
      return "user";
    case "toolResult":
      return "tool";
    case "custom":
      return "custom";
    default:
      return "system";
  }
}

function buildSeedTranscript(messages: unknown[]): CliShellTranscriptEntry[] {
  return messages.flatMap((message, index) => {
    const text = extractVisibleTextFromMessage(message);
    if (text.trim().length === 0) {
      return [];
    }
    return [
      {
        id: `seed:${index}`,
        role: transcriptRole(readMessageRole(message)),
        text,
        renderMode: "stable",
      },
    ];
  });
}

function replaceRange(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function findPathCompletionRange(
  text: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, cursor);
  const match = /(?:^|\s)@(?<path>"[^"]*|[^\s]*)$/u.exec(before);
  if (!match?.groups?.path) {
    return null;
  }
  const query = match.groups.path.replace(/^"/u, "");
  return {
    start: cursor - match.groups.path.length,
    end: cursor,
    query,
  };
}

function findSlashCompletion(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor);
  const match = /^\/(?<command>[^\s]*)$/u.exec(before.trim());
  return match?.groups?.command ?? null;
}

function normalizeBindingKey(key: string): string {
  switch (key) {
    case "return":
    case "linefeed":
      return "enter";
    default:
      return key.toLowerCase();
  }
}

function renderListValue(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function renderNullableBoolean(value: boolean | null): string {
  if (value === null) {
    return "n/a";
  }
  return value ? "yes" : "no";
}

function renderNotificationSummary(notification: {
  level: "info" | "warning" | "error";
  message: string;
}): string {
  return `[${notification.level}] ${notification.message}`;
}

function summarizeDraftPreview(text: string): {
  characters: number;
  lines: number;
  preview: string;
} {
  const trimmed = text.trim();
  return {
    characters: text.length,
    lines: Math.max(1, text.split(/\r?\n/u).length),
    preview: trimmed.split(/\r?\n/u)[0]?.slice(0, 96) ?? "",
  };
}

type SessionInspectReport = ReturnType<typeof buildSessionInspectReport>;

const CREDENTIAL_HELP_LINES = [
  "Brewva stores API keys in an encrypted local vault.",
  "",
  "Run these commands in a separate terminal to manage credentials:",
  "",
  "  Add from environment variable (recommended):",
  "    brewva credentials add --ref vault://openai/apiKey    --from-env OPENAI_API_KEY",
  "    brewva credentials add --ref vault://anthropic/apiKey --from-env ANTHROPIC_API_KEY",
  "    brewva credentials add --ref vault://gemini/apiKey    --from-env GEMINI_API_KEY",
  "    brewva credentials add --ref vault://google/apiKey    --from-env GOOGLE_API_KEY",
  "    brewva credentials add --ref vault://mistral/apiKey   --from-env MISTRAL_API_KEY",
  "    brewva credentials add --ref vault://groq/apiKey      --from-env GROQ_API_KEY",
  "    brewva credentials add --ref vault://xai/apiKey       --from-env XAI_API_KEY",
  "    brewva credentials add --ref vault://together/apiKey  --from-env TOGETHER_API_KEY",
  "    brewva credentials add --ref vault://github/token     --from-env GITHUB_TOKEN",
  "",
  "  Add a raw value directly:",
  "    brewva credentials add --ref vault://openai/apiKey --value sk-...",
  "",
  "  List stored credentials:",
  "    brewva credentials list",
  "",
  "  Discover credentials from current environment:",
  "    brewva credentials discover",
  "",
  "  Remove a credential:",
  "    brewva credentials remove --ref vault://openai/apiKey",
  "",
  "Environment variables are also accepted directly without storing them in the vault.",
  "Set OPENAI_API_KEY, ANTHROPIC_API_KEY, etc. before starting Brewva.",
];

function buildInspectSections(report: SessionInspectReport): CliOverlaySection[] {
  const base = report.base;
  const sections: CliOverlaySection[] = [
    {
      id: "summary",
      title: "Summary",
      lines: [
        `Session: ${base.sessionId}`,
        `Workspace: ${base.workspaceRoot}`,
        `Config mode: ${base.configLoad.mode}`,
        `Config paths: ${renderListValue(base.configLoad.paths)}`,
        `Managed tool mode: ${base.bootstrap.managedToolMode ?? "n/a"}`,
      ],
    },
    {
      id: "runtime",
      title: "Runtime",
      lines: [
        `Hydration: ${base.hydration.status} (issues=${base.hydration.issueCount})`,
        `Integrity: ${base.integrity.status} (issues=${base.integrity.issueCount})`,
        `Replay: events=${base.replay.eventCount} anchors=${base.replay.anchorCount} checkpoints=${base.replay.checkpointCount}`,
        `Tape pressure: ${base.replay.tapePressure}`,
        `Entries since anchor: ${base.replay.entriesSinceAnchor}`,
      ],
    },
    {
      id: "task",
      title: "Task + Truth",
      lines: [
        `Goal: ${base.task.goal ?? "n/a"}`,
        `Task phase: ${base.task.phase ?? "n/a"}`,
        `Task health: ${base.task.health ?? "n/a"}`,
        `Task items: ${base.task.items}`,
        `Task blockers: ${base.task.blockers}`,
        `Truth: ${base.truth.activeFacts}/${base.truth.totalFacts} active`,
      ],
    },
    {
      id: "skills",
      title: "Skills + Verification",
      lines: [
        `Active skill: ${base.skills.activeSkill ?? "none"}`,
        `Completed skills: ${renderListValue(base.skills.completedSkills)}`,
        `Verification outcome: ${base.verification.outcome ?? "n/a"}`,
        `Verification level: ${base.verification.level ?? "n/a"}`,
        `Failed checks: ${renderListValue(base.verification.failedChecks)}`,
        `Missing checks: ${renderListValue(base.verification.missingChecks)}`,
        `Missing evidence: ${renderListValue(base.verification.missingEvidence)}`,
        `Verification reason: ${base.verification.reason ?? "n/a"}`,
      ],
    },
    {
      id: "artifacts",
      title: "Artifacts",
      lines: [
        `Ledger: rows=${base.ledger.rows} integrity=${base.ledger.integrityValid ? "valid" : "invalid"}`,
        `Ledger path: ${base.ledger.path}`,
        `Projection: enabled=${base.projection.enabled ? "yes" : "no"} working=${base.projection.workingExists ? "present" : "missing"}`,
        `Projection path: ${base.projection.workingPath}`,
        `Recovery WAL: enabled=${base.recoveryWal.enabled ? "yes" : "no"} pending=${base.recoveryWal.pendingCount} sessionPending=${base.recoveryWal.pendingSessionCount}`,
        `Recovery WAL path: ${base.recoveryWal.filePath}`,
        `Snapshots: sessionDir=${base.snapshots.sessionDirExists ? "present" : "missing"} patchHistory=${base.snapshots.patchHistoryExists ? "present" : "missing"}`,
        `Patch history path: ${base.snapshots.patchHistoryPath}`,
        `Consistency: ledger=${base.consistency.ledgerIntegrity} pendingRecoveryWal=${base.consistency.pendingRecoveryWal}`,
      ],
    },
    {
      id: "routing",
      title: "Bootstrap + Routing",
      lines: [
        `Routing enabled: ${renderNullableBoolean(base.bootstrap.routingEnabled)}`,
        `Routing scopes: ${renderListValue(base.bootstrap.routingScopes)}`,
        `Routable skills: ${renderListValue(base.bootstrap.routableSkills)}`,
        `Hidden skills: ${renderListValue(base.bootstrap.hiddenSkills)}`,
        `Config path: ${base.bootstrap.configPath ?? "n/a"}`,
        `Events dir: ${base.bootstrap.eventsDir ?? "n/a"}`,
        `Recovery WAL dir: ${base.bootstrap.recoveryWalDir ?? "n/a"}`,
        `Projection dir: ${base.bootstrap.projectionDir ?? "n/a"}`,
      ],
    },
    {
      id: "hosted",
      title: "Hosted",
      lines: [
        `Transition sequence: ${base.hostedTransitions.sequence}`,
        `Latest: ${
          base.hostedTransitions.latest
            ? `${base.hostedTransitions.latest.reason}:${base.hostedTransitions.latest.status}`
            : "none"
        }`,
        `Pending family: ${base.hostedTransitions.pendingFamily ?? "none"}`,
        `Operator-visible generation: ${base.hostedTransitions.operatorVisibleFactGeneration}`,
        `Compaction breaker: ${base.hostedTransitions.breakerOpenByReason.compaction_retry ? "open" : "closed"} (${base.hostedTransitions.consecutiveFailuresByReason.compaction_retry ?? 0})`,
        `Provider fallback breaker: ${base.hostedTransitions.breakerOpenByReason.provider_fallback_retry ? "open" : "closed"} (${base.hostedTransitions.consecutiveFailuresByReason.provider_fallback_retry ?? 0})`,
        `Max-output breaker: ${base.hostedTransitions.breakerOpenByReason.max_output_recovery ? "open" : "closed"} (${base.hostedTransitions.consecutiveFailuresByReason.max_output_recovery ?? 0})`,
      ],
    },
  ];

  if (base.hydration.issues.length > 0 || base.integrity.issues.length > 0) {
    sections.push({
      id: "issues",
      title: "Issues",
      lines: [
        ...base.hydration.issues.map(
          (issue) =>
            `Hydration issue #${issue.index}: ${issue.eventType} :: ${issue.reason} (${issue.eventId})`,
        ),
        ...base.integrity.issues.map(
          (issue) =>
            `Integrity issue: ${issue.domain}/${issue.severity} :: ${issue.reason} (${issue.eventId ?? "n/a"})`,
        ),
      ],
    });
  }

  if (base.configLoad.warnings.length > 0) {
    sections.push({
      id: "config",
      title: "Config Warnings",
      lines: base.configLoad.warnings.map(
        (warning) =>
          `${warning.code}: ${warning.message} :: ${warning.configPath} :: ${renderListValue(
            warning.fields,
          )}`,
      ),
    });
  }

  if (base.recoveryWal.pendingRows.length > 0) {
    sections.push({
      id: "recovery",
      title: "Recovery WAL",
      lines: base.recoveryWal.pendingRows.map(
        (row) =>
          `${row.source}/${row.status} turn=${row.turnId} channel=${row.channel} tool=${row.toolName ?? "n/a"} updated=${row.updatedAt ?? "n/a"}`,
      ),
    });
  }

  sections.push({
    id: "analysis",
    title: "Analysis",
    lines: formatInspectAnalysisText(report).split("\n"),
  });

  return sections;
}

function buildOverlayView(payload: CliShellOverlayPayload): { title: string; lines: string[] } {
  switch (payload.kind) {
    case "approval": {
      const lines = [
        `Pending approvals: ${payload.snapshot.approvals.length}`,
        "Use ↑/↓ to choose, Enter or a to accept, r to reject, Esc to close.",
      ];
      for (const [index, item] of payload.snapshot.approvals.entries()) {
        const marker = index === payload.selectedIndex ? ">" : " ";
        lines.push(
          `${marker} [${item.requestId}] ${item.toolName} :: ${item.subject} :: ${item.effects.join(", ")}`,
        );
      }
      if (payload.snapshot.approvals.length === 0) {
        lines.push("No pending approvals.");
      }
      return { title: "Approvals", lines };
    }
    case "question": {
      const lines = [
        `Open questions: ${payload.snapshot.questions.length}`,
        "Use ↑/↓ to choose, Enter to answer from the composer, Esc to close.",
      ];
      for (const [index, item] of payload.snapshot.questions.entries()) {
        const marker = index === payload.selectedIndex ? ">" : " ";
        lines.push(`${marker} [${item.questionId}] ${item.sourceLabel} :: ${item.questionText}`);
      }
      if (payload.snapshot.questions.length === 0) {
        lines.push("No open questions.");
      }
      return { title: "Questions", lines };
    }
    case "tasks": {
      const lines = [
        `Task runs: ${payload.snapshot.taskRuns.length}`,
        "Use ↑/↓ to choose, c to cancel the selected run, Esc to close.",
      ];
      for (const [index, item] of payload.snapshot.taskRuns.entries()) {
        const marker = index === payload.selectedIndex ? ">" : " ";
        lines.push(`${marker} ${buildTaskRunListLabel(item)}`);
      }
      if (payload.snapshot.taskRuns.length === 0) {
        lines.push("No recorded task runs.");
      } else {
        const selected = payload.snapshot.taskRuns[payload.selectedIndex];
        if (selected) {
          lines.push("", ...buildTaskRunPreviewLines(selected));
        }
      }
      return { title: "Tasks", lines };
    }
    case "sessions": {
      const lines = [
        `Sessions: ${payload.sessions.length}`,
        "Use ↑/↓ to choose, Enter to switch, n to create a new session, Esc to close.",
      ];
      for (const [index, item] of payload.sessions.entries()) {
        const marker = index === payload.selectedIndex ? ">" : " ";
        const current = item.sessionId === payload.currentSessionId ? " current" : "";
        const draft = payload.draftStateBySessionId[item.sessionId];
        const draftText = draft ? ` draft=${draft.lines}l/${draft.characters}c` : "";
        lines.push(`${marker} [${item.sessionId}] events=${item.eventCount}${current}${draftText}`);
      }
      if (payload.sessions.length === 0) {
        lines.push("No sessions found.");
      }
      return { title: "Sessions", lines };
    }
    case "notifications": {
      const lines = [
        `Notifications: ${payload.notifications.length}`,
        "Use ↑/↓ to choose, Enter to inspect, d to dismiss, x to clear all, Esc to close.",
      ];
      for (const [index, item] of payload.notifications.entries()) {
        const marker = index === payload.selectedIndex ? ">" : " ";
        lines.push(`${marker} ${renderNotificationSummary(item)}`);
      }
      if (payload.notifications.length === 0) {
        lines.push("No notifications.");
      }
      return { title: "Notifications", lines };
    }
    case "inspect":
      return {
        title: "Inspect",
        lines: payload.sections.map(
          (section, index) => `${index === payload.selectedIndex ? ">" : " "} ${section.title}`,
        ),
      };
    case "pager":
      return { title: payload.title ?? "Pager", lines: payload.lines };
    case "confirm":
      return { title: "Confirm", lines: [payload.message, "", "Enter=yes  Esc=no"] };
    case "input":
      return {
        title: "Input",
        lines: [payload.message ?? "", "", payload.value, "", "Enter=confirm  Esc=cancel"],
      };
    case "select":
      return {
        title: "Select",
        lines: payload.options.map(
          (item, index) => `${index === payload.selectedIndex ? ">" : " "} ${item}`,
        ),
      };
    default: {
      const exhaustiveCheck: never = payload;
      return exhaustiveCheck;
    }
  }
}

export class CliShellController {
  static readonly STATUS_DEBOUNCE_MS = 120;
  readonly #completionPort;
  readonly #configPort = createShellConfigPort();
  readonly #keybindings = createKeybindingResolver([
    {
      id: "global.exit",
      context: "global",
      trigger: { key: "q", ctrl: true, meta: false, shift: false },
      action: "exit",
    },
    {
      id: "global.abort",
      context: "global",
      trigger: { key: "c", ctrl: true, meta: false, shift: false },
      action: "abortOrExit",
    },
    {
      id: "global.approvals",
      context: "global",
      trigger: { key: "a", ctrl: true, meta: false, shift: false },
      action: "openApprovals",
    },
    {
      id: "global.questions",
      context: "global",
      trigger: { key: "o", ctrl: true, meta: false, shift: false },
      action: "openQuestions",
    },
    {
      id: "global.tasks",
      context: "global",
      trigger: { key: "t", ctrl: true, meta: false, shift: false },
      action: "openTasks",
    },
    {
      id: "global.sessions",
      context: "global",
      trigger: { key: "g", ctrl: true, meta: false, shift: false },
      action: "openSessions",
    },
    {
      id: "global.inspect",
      context: "global",
      trigger: { key: "i", ctrl: true, meta: false, shift: false },
      action: "openInspect",
    },
    {
      id: "global.notifications",
      context: "global",
      trigger: { key: "n", ctrl: true, meta: false, shift: false },
      action: "openNotifications",
    },
    {
      id: "global.editor",
      context: "global",
      trigger: { key: "e", ctrl: true, meta: false, shift: false },
      action: "openEditor",
    },
    {
      id: "global.scrollUp",
      context: "global",
      trigger: { key: "pageup", ctrl: false, meta: false, shift: false },
      action: "scrollUp",
    },
    {
      id: "global.scrollDown",
      context: "global",
      trigger: { key: "pagedown", ctrl: false, meta: false, shift: false },
      action: "scrollDown",
    },
    {
      id: "composer.submit",
      context: "composer",
      trigger: { key: "enter", ctrl: false, meta: false, shift: false },
      action: "submit",
    },
    {
      id: "composer.newline",
      context: "composer",
      trigger: { key: "j", ctrl: true, meta: false, shift: false },
      action: "newline",
    },
    {
      id: "completion.accept",
      context: "completion",
      trigger: { key: "tab", ctrl: false, meta: false, shift: false },
      action: "acceptCompletion",
    },
    {
      id: "completion.acceptEnter",
      context: "completion",
      trigger: { key: "enter", ctrl: false, meta: false, shift: false },
      action: "acceptCompletion",
    },
    {
      id: "completion.next",
      context: "completion",
      trigger: { key: "down", ctrl: false, meta: false, shift: false },
      action: "nextCompletion",
    },
    {
      id: "completion.prev",
      context: "completion",
      trigger: { key: "up", ctrl: false, meta: false, shift: false },
      action: "prevCompletion",
    },
    {
      id: "overlay.close",
      context: "overlay",
      trigger: { key: "escape", ctrl: false, meta: false, shift: false },
      action: "closeOverlay",
    },
    {
      id: "overlay.select",
      context: "overlay",
      trigger: { key: "enter", ctrl: false, meta: false, shift: false },
      action: "overlayPrimary",
    },
    {
      id: "overlay.next",
      context: "overlay",
      trigger: { key: "down", ctrl: false, meta: false, shift: false },
      action: "overlayNext",
    },
    {
      id: "overlay.prev",
      context: "overlay",
      trigger: { key: "up", ctrl: false, meta: false, shift: false },
      action: "overlayPrev",
    },
    {
      id: "overlay.pageDown",
      context: "overlay",
      trigger: { key: "pagedown", ctrl: false, meta: false, shift: false },
      action: "overlayPageDown",
    },
    {
      id: "overlay.pageUp",
      context: "overlay",
      trigger: { key: "pageup", ctrl: false, meta: false, shift: false },
      action: "overlayPageUp",
    },
    {
      id: "pager.external",
      context: "pager",
      trigger: { key: "e", ctrl: true, meta: false, shift: false },
      action: "externalPager",
    },
  ]);
  readonly #listeners = new Set<() => void>();
  readonly #uiController;
  readonly #operatorPort;
  #state = createCliShellState();
  #bundle: CliShellSessionBundle;
  #sessionPort: SessionViewPort;
  #operatorSnapshot: OperatorSurfaceSnapshot = {
    approvals: [],
    questions: [],
    taskRuns: [],
    sessions: [],
  };
  #unsubscribeSession: (() => void) | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #statusTimer: ReturnType<typeof setTimeout> | undefined;
  #queuedStatusActions: CliShellAction[] = [];
  #assistantEntryId: string | undefined;
  #resolveExit: (() => void) | undefined;
  readonly #exitPromise: Promise<void>;
  #seenApprovals = new Set<string>();
  #seenQuestions = new Set<string>();
  #measureWidth = 80;
  #viewportRows = 24;
  #semanticInputQueue: Promise<void> = Promise.resolve();
  #draftsBySessionId = new Map<
    string,
    {
      text: string;
      cursor: number;
      updatedAt: number;
    }
  >();
  #started = false;
  #disposed = false;

  constructor(
    bundle: CliShellSessionBundle,
    private readonly options: CliShellControllerOptions,
  ) {
    this.#bundle = bundle;
    this.#sessionPort = createSessionViewPort(bundle);
    this.#completionPort = createWorkspaceCompletionPort(options.cwd);
    this.#operatorPort = createOperatorSurfacePort({
      getBundle: () => this.#bundle,
      openSession: (sessionId) => options.openSession(sessionId),
      createSession: () => options.createSession(),
    });
    this.#uiController = createCliShellUiPortController({
      dispatch: (action) => this.dispatch(action),
      getState: () => this.#state,
      requestDialog: (request) => this.requestDialog(request),
      openExternalEditor: (title, prefill) => this.openExternalEditor(title, prefill),
      requestRender: () => this.emitChange(),
    });
    this.#exitPromise = new Promise<void>((resolve) => {
      this.#resolveExit = resolve;
    });
    bundle.session.setUiPort(this.ui);
  }

  get ui(): CliShellUiPort {
    return this.#uiController.ui;
  }

  getState(): CliShellState {
    return this.#state;
  }

  getBundle(): CliShellSessionBundle {
    return this.#bundle;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.initializeState();
    this.mountSession(this.#bundle);
    this.#pollTimer = setInterval(() => {
      void this.refreshOperatorSnapshot().catch((error) => {
        this.ui.notify(
          error instanceof Error ? error.message : "Failed to refresh operator snapshot.",
          "warning",
        );
      });
    }, this.options.operatorPollIntervalMs ?? 750);
    await this.refreshOperatorSnapshot();

    if (this.options.initialMessage?.trim()) {
      const initialMessage = this.options.initialMessage.trim();
      this.dispatch({
        type: "composer.setText",
        text: initialMessage,
        cursor: initialMessage.length,
      });
      await this.submitComposer();
    }
  }

  async waitForExit(): Promise<void> {
    await this.#exitPromise;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#started = false;
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
    }
    if (this.#statusTimer) {
      clearTimeout(this.#statusTimer);
    }
    this.#unsubscribeSession?.();
    this.#listeners.clear();
    this.#resolveExit?.();
  }

  setViewportSize(columns: number, _rows: number): void {
    this.#measureWidth = Math.max(24, columns - 8);
    this.#viewportRows = Math.max(12, _rows);
  }

  syncComposerFromEditor(text: string, cursor: number): void {
    if (this.#state.composer.text === text && this.#state.composer.cursor === cursor) {
      return;
    }
    this.dispatch({
      type: "composer.setText",
      text,
      cursor,
    });
  }

  private getInputContexts(): KeybindingContext[] {
    const activeOverlay = this.#state.overlay.active?.payload;
    if (activeOverlay?.kind === "pager") {
      return ["pager", "overlay", "global"];
    }
    if (activeOverlay) {
      return ["overlay", "global"];
    }
    if (this.#state.composer.completion) {
      return ["completion", "composer", "global"];
    }
    return ["composer", "global"];
  }

  openOverlay(payload: CliShellOverlayPayload, priority: OverlayPriority = "normal"): void {
    this.openOverlayWithOptions(payload, { priority });
  }

  private openOverlayWithOptions(
    payload: CliShellOverlayPayload,
    options: {
      priority?: OverlayPriority;
      suspendCurrent?: boolean;
    } = {},
  ): void {
    const view = buildOverlayView(payload);
    const activeOverlay = this.#state.overlay.active;
    this.dispatch({
      type: "overlay.open",
      overlay: {
        id: `${payload.kind}:${Date.now()}`,
        kind: payload.kind,
        focusOwner:
          payload.kind === "approval"
            ? "approvalOverlay"
            : payload.kind === "question"
              ? "questionOverlay"
              : payload.kind === "tasks"
                ? "taskBrowser"
                : payload.kind === "sessions"
                  ? "sessionSwitcher"
                  : payload.kind === "notifications"
                    ? "notificationCenter"
                    : payload.kind === "inspect"
                      ? "inspectOverlay"
                      : payload.kind === "pager"
                        ? "pager"
                        : "dialog",
        priority: options.priority ?? "normal",
        suspendFocusOwner: options.suspendCurrent ? activeOverlay?.focusOwner : undefined,
        title: view.title,
        lines: view.lines,
        payload,
      },
    });
  }

  wantsSemanticInput(input: CliShellSemanticInput): boolean {
    const activeOverlay = this.#state.overlay.active?.payload;
    const contexts = this.getInputContexts();

    const binding = this.#keybindings.resolve(contexts, {
      key: normalizeBindingKey(input.key),
      ctrl: input.ctrl,
      meta: input.meta,
      shift: input.shift,
    });
    if (binding) {
      return true;
    }
    if (activeOverlay) {
      return true;
    }
    return false;
  }

  async handleSemanticInput(input: CliShellSemanticInput): Promise<boolean> {
    const task = this.#semanticInputQueue.then(() => this.handleSemanticInputNow(input));
    this.#semanticInputQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  }

  private async handleSemanticInputNow(input: CliShellSemanticInput): Promise<boolean> {
    const activeOverlay = this.#state.overlay.active?.payload;
    try {
      const binding = this.#keybindings.resolve(this.getInputContexts(), {
        key: normalizeBindingKey(input.key),
        ctrl: input.ctrl,
        meta: input.meta,
        shift: input.shift,
      });
      if (binding) {
        await this.handleBinding(binding.action);
        return true;
      }

      if (activeOverlay?.kind === "input") {
        if (normalizeBindingKey(input.key) === "backspace") {
          this.replaceActiveOverlay({
            ...activeOverlay,
            value: activeOverlay.value.slice(0, -1),
          });
          return true;
        }
        if (normalizeBindingKey(input.key) === "character" && typeof input.text === "string") {
          this.replaceActiveOverlay({
            ...activeOverlay,
            value: `${activeOverlay.value}${input.text}`,
          });
          return true;
        }
        return true;
      }

      if (activeOverlay) {
        const handled = await this.handleOverlayShortcut(activeOverlay, input);
        return handled || typeof input.text === "string" || input.key.length > 0;
      }

      return false;
    } catch (error) {
      this.ui.notify(
        error instanceof Error ? error.message : "Failed to process interactive input.",
        "error",
      );
      return true;
    }
  }

  private emitChange(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  private initializeState(): void {
    this.#state = createCliShellState();
    this.#assistantEntryId = undefined;
    this.#seenApprovals = new Set();
    this.#seenQuestions = new Set();
    const restoredDraft = this.#draftsBySessionId.get(this.#sessionPort.getSessionId());
    this.applyActions(
      [
        {
          type: "status.title",
          title: `Session ${this.#sessionPort.getSessionId()} (${this.#sessionPort.getModelLabel()})`,
        },
        {
          type: "status.set",
          key: "thinking",
          text: this.#sessionPort.getThinkingLevel(),
        },
      ],
      false,
    );
    if (this.options.verbose) {
      this.dispatch({
        type: "notification.add",
        notification: {
          id: "startup",
          level: "info",
          message: `Interactive shell attached to ${this.#sessionPort.getSessionId()}.`,
          createdAt: Date.now(),
        },
      });
    }
    for (const entry of buildSeedTranscript(this.#sessionPort.getTranscriptSeed())) {
      this.#state = reduceCliShellState(this.#state, {
        type: "transcript.append",
        entry,
      });
    }
    if (restoredDraft) {
      this.#state = reduceCliShellState(this.#state, {
        type: "composer.setText",
        text: restoredDraft.text,
        cursor: restoredDraft.cursor,
      });
    }
    this.emitChange();
  }

  private mountSession(bundle: CliShellSessionBundle): void {
    this.#bundle = bundle;
    bundle.session.setUiPort(this.ui);
    this.#sessionPort = createSessionViewPort(bundle);
    this.options.onBundleChange?.(bundle);
    this.#unsubscribeSession?.();
    this.#unsubscribeSession = this.#sessionPort.subscribe((event) =>
      this.handleSessionEvent(event),
    );
  }

  private applyActions(actions: readonly CliShellAction[], refreshCompletions = true): void {
    if (actions.length === 0) {
      return;
    }
    for (const action of actions) {
      this.#state = reduceCliShellState(this.#state, action);
    }
    if (
      actions.some(
        (action) =>
          action.type === "notification.add" ||
          action.type === "notification.dismiss" ||
          action.type === "notification.clear",
      )
    ) {
      this.syncNotificationsOverlay();
    }
    if (refreshCompletions) {
      this.refreshCompletion();
    }
    this.emitChange();
  }

  private queueStatusActions(
    actions: readonly CliShellAction[],
    debounceMs = CliShellController.STATUS_DEBOUNCE_MS,
  ): void {
    this.#queuedStatusActions.push(...actions);
    if (this.#statusTimer) {
      return;
    }
    this.#statusTimer = setTimeout(() => {
      this.#statusTimer = undefined;
      const queued = this.#queuedStatusActions.splice(0);
      this.applyActions(queued);
    }, debounceMs);
  }

  private dispatch(action: CliShellAction, debounceStatus = true): void {
    if (action.type.startsWith("status.") && debounceStatus) {
      this.queueStatusActions([action]);
      return;
    }
    this.applyActions([action]);
  }

  private dispatchMany(actions: readonly CliShellAction[], debounceStatus = true): void {
    if (actions.length === 0) {
      return;
    }
    const immediate: CliShellAction[] = [];
    const deferred: CliShellAction[] = [];
    for (const action of actions) {
      if (action.type.startsWith("status.") && debounceStatus) {
        deferred.push(action);
      } else {
        immediate.push(action);
      }
    }
    if (deferred.length > 0) {
      this.queueStatusActions(deferred);
    }
    if (immediate.length > 0) {
      this.applyActions(immediate);
    }
  }

  private adjustScrolledTranscriptAnchor(
    previousEntry: CliShellTranscriptEntry,
    nextEntry: CliShellTranscriptEntry,
    options: {
      previousMode?: "stable" | "streaming";
      nextMode?: "stable" | "streaming";
    } = {},
  ): void {
    if (this.#state.transcript.followMode !== "scrolled") {
      return;
    }
    const previousHeight = measureTranscriptEntryLines(
      previousEntry,
      this.#measureWidth,
      options.previousMode ?? "stable",
    );
    const nextHeight = measureTranscriptEntryLines(
      nextEntry,
      this.#measureWidth,
      options.nextMode ?? "stable",
    );
    const lineDelta = nextHeight - previousHeight;
    if (lineDelta !== 0) {
      this.dispatch(
        {
          type: "transcript.scroll",
          delta: lineDelta,
        },
        false,
      );
    }
  }

  private appendTranscriptEntry(
    entry: CliShellTranscriptEntry,
    options: {
      nextMode?: "stable" | "streaming";
    } = {},
  ): void {
    const nextEntry = {
      ...entry,
      renderMode: options.nextMode ?? entry.renderMode ?? "stable",
    } satisfies CliShellTranscriptEntry;
    this.adjustScrolledTranscriptAnchor(
      {
        id: nextEntry.id,
        role: nextEntry.role,
        text: "",
        renderMode: nextEntry.renderMode,
      },
      nextEntry,
      {
        previousMode: nextEntry.renderMode,
        nextMode: nextEntry.renderMode,
      },
    );
    this.dispatch(
      {
        type: "transcript.append",
        entry: nextEntry,
      },
      false,
    );
  }

  private upsertTranscriptEntry(
    entry: CliShellTranscriptEntry,
    options: {
      previousMode?: "stable" | "streaming";
      nextMode?: "stable" | "streaming";
    } = {},
  ): void {
    const nextEntry = {
      ...entry,
      renderMode: options.nextMode ?? entry.renderMode ?? "stable",
    } satisfies CliShellTranscriptEntry;
    const existing = this.#state.transcript.entries.find(
      (candidate) => candidate.id === nextEntry.id,
    );
    if (!existing) {
      this.appendTranscriptEntry(nextEntry, { nextMode: nextEntry.renderMode });
      return;
    }
    this.adjustScrolledTranscriptAnchor(existing, nextEntry, options);
    this.dispatch(
      {
        type: "transcript.upsert",
        entry: nextEntry,
      },
      false,
    );
  }

  private handleSessionEvent(event: BrewvaPromptSessionEvent): void {
    if (event.type === "message_update") {
      const delta = asRecord(event.assistantMessageEvent)?.delta;
      if (typeof delta === "string" && delta.length > 0) {
        const id = this.#assistantEntryId ?? `assistant:${Date.now()}`;
        this.#assistantEntryId = id;
        const existing = this.#state.transcript.entries.find((entry) => entry.id === id);
        this.upsertTranscriptEntry(
          {
            id,
            role: "assistant",
            text: `${existing?.text ?? ""}${delta}`,
            renderMode: "streaming",
          },
          {
            previousMode: "streaming",
            nextMode: "streaming",
          },
        );
      }
      return;
    }

    if (event.type === "message_end") {
      const role = readMessageRole(event.message);
      const text = extractVisibleTextFromMessage(event.message);
      const errorMessage =
        role === "assistant" && readMessageStopReason(event.message) === "error"
          ? extractMessageError(event.message)
          : undefined;
      if (errorMessage) {
        this.ui.notify(errorMessage, "error");
      }
      if (role === "assistant" && this.#assistantEntryId) {
        const id = this.#assistantEntryId;
        const existing = this.#state.transcript.entries.find((entry) => entry.id === id);
        const nextEntry = {
          id,
          role: "assistant" as const,
          text: text.trim().length > 0 ? text : (existing?.text ?? ""),
          renderMode: "stable" as const,
        };
        if (nextEntry.text.length > 0) {
          this.upsertTranscriptEntry(nextEntry, {
            previousMode: "streaming",
            nextMode: "stable",
          });
        }
        this.#assistantEntryId = undefined;
        return;
      }
      if (text.trim().length > 0 && role === "assistant" && !this.#assistantEntryId) {
        this.appendTranscriptEntry({
          id: `assistant:end:${Date.now()}`,
          role: "assistant",
          text,
          renderMode: "stable",
        });
      }
      this.#assistantEntryId = undefined;
      return;
    }

    if (event.type === "tool_execution_start" && event.toolName) {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const toolCallId =
        typeof event.toolCallId === "string" ? event.toolCallId : String(Date.now());
      this.appendTranscriptEntry({
        id: `tool:${toolCallId}`,
        role: "tool",
        text: `${toolName} started`,
        renderMode: "stable",
      });
      return;
    }

    if (event.type === "tool_execution_end" && event.toolName) {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const toolCallId =
        typeof event.toolCallId === "string" ? event.toolCallId : String(Date.now());
      this.appendTranscriptEntry({
        id: `tool:end:${toolCallId}`,
        role: "tool",
        text: `${toolName} ${event.isError ? "failed" : "completed"}`,
        renderMode: "stable",
      });
      return;
    }

    if (event.type === "session_phase_change") {
      const phase = asRecord(event.phase);
      this.dispatch({
        type: "status.set",
        key: "phase",
        text: typeof phase?.kind === "string" ? phase.kind : undefined,
      });
      return;
    }

    if (event.type === "context_state_change") {
      const contextState = asRecord(event.state);
      this.dispatch({
        type: "status.set",
        key: "pressure",
        text:
          typeof contextState?.budgetPressure === "string"
            ? contextState.budgetPressure
            : undefined,
      });
    }
  }

  private syncSnapshotOverlay(snapshot: OperatorSurfaceSnapshot): void {
    const active = this.#state.overlay.active?.payload;
    if (!active) {
      return;
    }

    if (active.kind === "approval") {
      this.replaceActiveOverlay({
        ...active,
        selectedIndex: Math.max(0, Math.min(active.selectedIndex, snapshot.approvals.length - 1)),
        snapshot,
      });
      return;
    }
    if (active.kind === "question") {
      this.replaceActiveOverlay({
        ...active,
        selectedIndex: Math.max(0, Math.min(active.selectedIndex, snapshot.questions.length - 1)),
        snapshot,
      });
      return;
    }
    if (active.kind === "tasks") {
      this.replaceActiveOverlay({
        ...active,
        selectedIndex: Math.max(0, Math.min(active.selectedIndex, snapshot.taskRuns.length - 1)),
        snapshot,
      });
      return;
    }
    if (active.kind === "sessions") {
      this.replaceActiveOverlay(
        this.buildSessionsOverlayPayload(snapshot, {
          sessionId: active.sessions[active.selectedIndex]?.sessionId,
          index: active.selectedIndex,
        }),
      );
    }
  }

  private async refreshOperatorSnapshot(): Promise<void> {
    const snapshot = await this.#operatorPort.getSnapshot();
    this.#operatorSnapshot = snapshot;
    this.syncSnapshotOverlay(snapshot);
    this.dispatchMany([
      {
        type: "status.set",
        key: "approvals",
        text: String(snapshot.approvals.length),
      },
      {
        type: "status.set",
        key: "questions",
        text: String(snapshot.questions.length),
      },
      {
        type: "status.set",
        key: "tasks",
        text: String(snapshot.taskRuns.length),
      },
    ]);

    const newApproval = snapshot.approvals.find((item) => !this.#seenApprovals.has(item.requestId));
    if (newApproval) {
      for (const item of snapshot.approvals) {
        this.#seenApprovals.add(item.requestId);
      }
      this.openOverlay(
        {
          kind: "approval",
          selectedIndex: snapshot.approvals.findIndex(
            (item) => item.requestId === newApproval.requestId,
          ),
          snapshot,
        },
        "queued",
      );
    }

    const newQuestion = snapshot.questions.find(
      (item) => !this.#seenQuestions.has(item.questionId),
    );
    if (newQuestion) {
      for (const item of snapshot.questions) {
        this.#seenQuestions.add(item.questionId);
      }
      this.openOverlay(
        {
          kind: "question",
          selectedIndex: snapshot.questions.findIndex(
            (item) => item.questionId === newQuestion.questionId,
          ),
          snapshot,
        },
        "queued",
      );
    }
  }

  private replaceActiveOverlay(payload: CliShellOverlayPayload): void {
    const active = this.#state.overlay.active;
    if (!active) {
      return;
    }
    const view = buildOverlayView(payload);
    this.dispatch(
      {
        type: "overlay.replace",
        overlay: {
          ...active,
          title: view.title,
          lines: view.lines,
          payload,
        },
      },
      false,
    );
  }

  private async handleOverlayShortcut(
    active: CliShellOverlayPayload,
    input: CliShellSemanticInput,
  ): Promise<boolean> {
    if (input.ctrl || input.meta || normalizeBindingKey(input.key) !== "character" || !input.text) {
      return false;
    }
    const key = input.text.toLowerCase();

    if (active.kind === "approval") {
      const item = active.snapshot.approvals[active.selectedIndex];
      if (!item) {
        return true;
      }
      if (key === "a") {
        await this.#operatorPort.decideApproval(item.requestId, {
          decision: "accept",
          actor: "brewva-cli",
        });
        this.ui.notify(`Approved ${item.requestId}.`, "info");
        this.closeActiveOverlay(false);
        await this.refreshOperatorSnapshot();
        return true;
      }
      if (key === "r") {
        await this.#operatorPort.decideApproval(item.requestId, {
          decision: "reject",
          actor: "brewva-cli",
        });
        this.ui.notify(`Rejected ${item.requestId}.`, "warning");
        this.closeActiveOverlay(false);
        await this.refreshOperatorSnapshot();
        return true;
      }
    }

    if (active.kind === "tasks" && key === "c") {
      const item = active.snapshot.taskRuns[active.selectedIndex];
      if (!item) {
        return true;
      }
      await this.#operatorPort.stopTask(item.runId);
      this.ui.notify(`Stopped task ${item.runId}.`, "warning");
      this.closeActiveOverlay(false);
      await this.refreshOperatorSnapshot();
      return true;
    }

    if (active.kind === "notifications") {
      if (key === "d") {
        const item = active.notifications[active.selectedIndex];
        if (!item) {
          return true;
        }
        this.dispatch(
          {
            type: "notification.dismiss",
            id: item.id,
          },
          false,
        );
        return true;
      }
      if (key === "x") {
        this.dispatch(
          {
            type: "notification.clear",
          },
          false,
        );
        return true;
      }
    }

    if (active.kind === "sessions" && key === "n") {
      await this.switchBundle(await this.#operatorPort.createSession());
      this.closeActiveOverlay(false);
      return true;
    }

    if (active.kind === "confirm") {
      if (key === "y") {
        active.resolve(true);
        this.closeActiveOverlay(false);
        return true;
      }
      if (key === "n") {
        active.resolve(false);
        this.closeActiveOverlay(false);
        return true;
      }
    }

    return false;
  }

  private async handleBinding(action: string): Promise<void> {
    switch (action) {
      case "exit":
        this.#resolveExit?.();
        return;
      case "abortOrExit":
        if (this.#bundle.session.isStreaming) {
          await this.#sessionPort.abort();
          this.ui.notify("Aborted the current turn.", "warning");
          return;
        }
        this.#resolveExit?.();
        return;
      case "submit":
        await this.submitComposer();
        return;
      case "newline":
        this.ui.pasteToEditor("\n");
        return;
      case "acceptCompletion":
        this.acceptCompletion();
        return;
      case "nextCompletion":
        this.moveCompletion(1);
        return;
      case "prevCompletion":
        this.moveCompletion(-1);
        return;
      case "closeOverlay":
        this.closeActiveOverlay(false);
        return;
      case "overlayPrimary":
        await this.handleOverlayPrimary();
        return;
      case "overlayNext":
        this.moveOverlaySelection(1);
        return;
      case "overlayPrev":
        this.moveOverlaySelection(-1);
        return;
      case "overlayPageDown":
        this.scrollActiveOverlay(this.getOverlayPageStep());
        return;
      case "overlayPageUp":
        this.scrollActiveOverlay(-this.getOverlayPageStep());
        return;
      case "externalPager":
        await this.openActivePagerExternally();
        return;
      case "openApprovals":
        this.openOverlay({ kind: "approval", selectedIndex: 0, snapshot: this.#operatorSnapshot });
        return;
      case "openQuestions":
        this.openOverlay({ kind: "question", selectedIndex: 0, snapshot: this.#operatorSnapshot });
        return;
      case "openTasks":
        this.openOverlay({ kind: "tasks", selectedIndex: 0, snapshot: this.#operatorSnapshot });
        return;
      case "openSessions":
        this.openSessionsOverlay();
        return;
      case "openInspect":
        await this.openInspectOverlay();
        return;
      case "openNotifications":
        this.openNotificationsOverlay();
        return;
      case "openEditor": {
        const externalPagerTarget = this.getExternalPagerTarget();
        if (externalPagerTarget) {
          await this.openExternalPagerTarget(externalPagerTarget);
          return;
        }
        const edited = await this.openExternalEditor("brewva-composer", this.#state.composer.text);
        if (typeof edited === "string") {
          this.dispatch({
            type: "composer.setText",
            text: edited,
            cursor: edited.length,
          });
        }
        return;
      }
      case "scrollUp":
        this.dispatch({ type: "transcript.scroll", delta: this.getTranscriptPageStep() }, false);
        return;
      case "scrollDown":
        this.dispatch({ type: "transcript.scroll", delta: -this.getTranscriptPageStep() }, false);
        if (this.#state.transcript.scrollOffset === 0) {
          this.dispatch({ type: "transcript.followLive" }, false);
        }
        return;
      default:
        return;
    }
  }

  private refreshCompletion(): void {
    const slashQuery = findSlashCompletion(this.#state.composer.text, this.#state.composer.cursor);
    if (slashQuery !== null) {
      const items = this.#completionPort
        .listSlashCommands()
        .filter((entry) => entry.command.startsWith(slashQuery))
        .map((entry) => `/${entry.command}`);
      this.#state = reduceCliShellState(this.#state, {
        type: "completion.set",
        completion:
          items.length > 0
            ? {
                kind: "slash",
                query: slashQuery,
                items,
                selectedIndex: 0,
              }
            : undefined,
      });
      return;
    }

    const pathRange = findPathCompletionRange(
      this.#state.composer.text,
      this.#state.composer.cursor,
    );
    if (pathRange) {
      const items = this.#completionPort.listPaths(pathRange.query);
      this.#state = reduceCliShellState(this.#state, {
        type: "completion.set",
        completion:
          items.length > 0
            ? {
                kind: "path",
                query: pathRange.query,
                items: items.map((item) => `@${item}`),
                selectedIndex: 0,
              }
            : undefined,
      });
      return;
    }

    this.#state = reduceCliShellState(this.#state, {
      type: "completion.set",
      completion: undefined,
    });
  }

  private moveCompletion(delta: number): void {
    const completion = this.#state.composer.completion;
    if (!completion) {
      return;
    }
    const nextIndex =
      (completion.selectedIndex + delta + completion.items.length) % completion.items.length;
    this.dispatch(
      {
        type: "completion.set",
        completion: {
          ...completion,
          selectedIndex: nextIndex,
        },
      },
      false,
    );
  }

  private acceptCompletion(): void {
    const completion = this.#state.composer.completion;
    if (!completion) {
      return;
    }
    const selected = completion.items[completion.selectedIndex];
    if (!selected) {
      return;
    }
    if (completion.kind === "slash") {
      const nextText = `/${selected.slice(1)} `;
      this.dispatch({
        type: "composer.setText",
        text: nextText,
        cursor: nextText.length,
      });
      return;
    }
    const pathRange = findPathCompletionRange(
      this.#state.composer.text,
      this.#state.composer.cursor,
    );
    if (!pathRange) {
      return;
    }
    const nextText = replaceRange(
      this.#state.composer.text,
      pathRange.start,
      pathRange.end,
      selected.slice(1),
    );
    this.dispatch({
      type: "composer.setText",
      text: nextText,
      cursor: pathRange.start + selected.length - 1,
    });
  }

  private async submitComposer(): Promise<void> {
    const prompt = this.#state.composer.text.trim();
    if (!prompt) {
      return;
    }
    const handled = await this.handleShellCommand(prompt);
    if (handled) {
      this.dispatch({
        type: "composer.setText",
        text: "",
        cursor: 0,
      });
      return;
    }
    this.appendTranscriptEntry({
      id: `user:${Date.now()}`,
      role: "user",
      text: prompt,
    });
    this.dispatch({
      type: "composer.setText",
      text: "",
      cursor: 0,
    });
    await this.#sessionPort.prompt(prompt, {
      source: "interactive",
      streamingBehavior: this.#bundle.session.isStreaming ? "followUp" : undefined,
    });
  }

  private async handleShellCommand(prompt: string): Promise<boolean> {
    if (prompt === "/quit" || prompt === "/exit") {
      this.#resolveExit?.();
      return true;
    }
    if (prompt === "/sessions") {
      this.openSessionsOverlay();
      return true;
    }
    if (prompt === "/questions") {
      this.openOverlay({ kind: "question", selectedIndex: 0, snapshot: this.#operatorSnapshot });
      return true;
    }
    if (prompt === "/approvals") {
      this.openOverlay({ kind: "approval", selectedIndex: 0, snapshot: this.#operatorSnapshot });
      return true;
    }
    if (prompt === "/tasks") {
      this.openOverlay({ kind: "tasks", selectedIndex: 0, snapshot: this.#operatorSnapshot });
      return true;
    }
    if (prompt === "/inspect") {
      await this.openInspectOverlay();
      return true;
    }
    if (prompt === "/notifications" || prompt === "/inbox") {
      this.openNotificationsOverlay();
      return true;
    }
    if (prompt === "/new") {
      await this.switchBundle(await this.#operatorPort.createSession());
      return true;
    }
    if (prompt === "/credentials" || prompt === "/auth") {
      this.openOverlay({
        kind: "pager",
        title: "Credentials",
        lines: CREDENTIAL_HELP_LINES,
        scrollOffset: 0,
      });
      return true;
    }
    if (prompt === "/theme" || prompt === "/theme list") {
      const themeNames = this.ui
        .getAllThemes()
        .map((theme) => theme.name)
        .join(", ");
      this.ui.notify(`Available themes: ${themeNames}`, "info");
      return true;
    }
    if (prompt.startsWith("/theme ")) {
      const selection = prompt.slice("/theme ".length).trim();
      if (selection.length === 0) {
        this.ui.notify("Usage: /theme <name>", "warning");
        return true;
      }
      const result = this.ui.setTheme(selection);
      if (result.success) {
        this.ui.notify(`Theme switched to ${selection}.`, "info");
      } else {
        this.ui.notify(result.error ?? "Unknown theme selection.", "warning");
      }
      return true;
    }
    if (prompt.startsWith("/answer ")) {
      const [questionId, ...answerParts] = prompt.slice("/answer ".length).trim().split(/\s+/u);
      const answerText = answerParts.join(" ").trim();
      if (!questionId || !answerText) {
        this.ui.notify("Usage: /answer <questionId> <text>", "warning");
        return true;
      }
      await this.#operatorPort.answerQuestion(questionId, answerText);
      await this.refreshOperatorSnapshot();
      return true;
    }
    return false;
  }

  private moveOverlaySelection(delta: number): void {
    const active = this.#state.overlay.active?.payload;
    if (!active) {
      return;
    }
    if (active.kind === "pager") {
      this.scrollActiveOverlay(delta);
      return;
    }
    if (
      active.kind === "approval" ||
      active.kind === "question" ||
      active.kind === "tasks" ||
      active.kind === "sessions" ||
      active.kind === "notifications" ||
      active.kind === "inspect" ||
      active.kind === "select"
    ) {
      const items =
        active.kind === "approval"
          ? active.snapshot.approvals
          : active.kind === "question"
            ? active.snapshot.questions
            : active.kind === "tasks"
              ? active.snapshot.taskRuns
              : active.kind === "sessions"
                ? active.sessions
                : active.kind === "notifications"
                  ? active.notifications
                  : active.kind === "inspect"
                    ? active.sections
                    : active.options;
      if (items.length === 0) {
        return;
      }
      const selectedIndex = (active.selectedIndex + delta + items.length) % items.length;
      this.replaceActiveOverlay({
        ...active,
        selectedIndex,
      });
    }
  }

  private getTranscriptPageStep(): number {
    return Math.max(3, Math.floor(Math.max(8, this.#viewportRows - 10) / 2));
  }

  private getOverlayPageStep(): number {
    return Math.max(4, Math.floor(Math.max(10, this.#viewportRows - 8) / 2));
  }

  private scrollActiveOverlay(delta: number): void {
    const active = this.#state.overlay.active?.payload;
    if (!active) {
      return;
    }
    if (active.kind === "pager") {
      this.replaceActiveOverlay({
        ...active,
        scrollOffset: Math.max(0, active.scrollOffset + delta),
      });
      return;
    }
    if (active.kind === "inspect") {
      const nextOffsets = [...active.scrollOffsets];
      const currentOffset = nextOffsets[active.selectedIndex] ?? 0;
      nextOffsets[active.selectedIndex] = Math.max(0, currentOffset + delta);
      this.replaceActiveOverlay({
        ...active,
        scrollOffsets: nextOffsets,
      });
    }
  }

  private closeActiveOverlay(cancelled: boolean): void {
    const active = this.#state.overlay.active;
    const payload = active?.payload;
    if (!active || !payload) {
      return;
    }
    if (cancelled) {
      if (payload.kind === "confirm") {
        payload.resolve(false);
      } else if (payload.kind === "input" || payload.kind === "select") {
        payload.resolve(undefined);
      }
    }
    this.dispatch(
      {
        type: "overlay.close",
        id: active.id,
      },
      false,
    );
  }

  private async handleOverlayPrimary(): Promise<void> {
    const active = this.#state.overlay.active?.payload;
    if (!active) {
      return;
    }
    switch (active.kind) {
      case "approval": {
        const item = active.snapshot.approvals[active.selectedIndex];
        if (!item) {
          return;
        }
        await this.#operatorPort.decideApproval(item.requestId, {
          decision: "accept",
          actor: "brewva-cli",
        });
        this.ui.notify(`Approved ${item.requestId}.`, "info");
        this.closeActiveOverlay(false);
        await this.refreshOperatorSnapshot();
        return;
      }
      case "question": {
        const item = active.snapshot.questions[active.selectedIndex];
        if (!item) {
          return;
        }
        const answerPrefix = `/answer ${item.questionId} `;
        this.dispatch({
          type: "composer.setText",
          text: answerPrefix,
          cursor: answerPrefix.length,
        });
        this.closeActiveOverlay(false);
        return;
      }
      case "tasks": {
        const item = active.snapshot.taskRuns[active.selectedIndex];
        if (!item) {
          return;
        }
        const detailTarget = this.getExternalPagerTarget();
        if (!detailTarget) {
          return;
        }
        this.openOverlayWithOptions(
          {
            kind: "pager",
            title: detailTarget.title,
            lines: [...detailTarget.lines],
            scrollOffset: 0,
          },
          {
            suspendCurrent: true,
          },
        );
        return;
      }
      case "sessions": {
        const item = active.sessions[active.selectedIndex];
        if (!item) {
          return;
        }
        if (item.sessionId === this.#sessionPort.getSessionId()) {
          this.closeActiveOverlay(false);
          return;
        }
        await this.switchBundle(await this.#operatorPort.openSession(item.sessionId));
        this.closeActiveOverlay(false);
        return;
      }
      case "notifications": {
        const item = active.notifications[active.selectedIndex];
        if (!item) {
          return;
        }
        const detailTarget = this.getExternalPagerTarget();
        if (!detailTarget) {
          return;
        }
        this.openOverlayWithOptions(
          {
            kind: "pager",
            title: detailTarget.title,
            lines: [...detailTarget.lines],
            scrollOffset: 0,
          },
          {
            suspendCurrent: true,
          },
        );
        return;
      }
      case "confirm":
        active.resolve(true);
        this.closeActiveOverlay(false);
        return;
      case "input":
        active.resolve(active.value.trim().length > 0 ? active.value : undefined);
        this.closeActiveOverlay(false);
        return;
      case "select":
        active.resolve(active.options[active.selectedIndex]);
        this.closeActiveOverlay(false);
        return;
      case "inspect": {
        const section = active.sections[active.selectedIndex];
        if (!section) {
          return;
        }
        const detailTarget = this.getExternalPagerTarget();
        if (!detailTarget) {
          return;
        }
        this.openOverlayWithOptions(
          {
            kind: "pager",
            title: detailTarget.title,
            lines: [...detailTarget.lines],
            scrollOffset: active.scrollOffsets[active.selectedIndex] ?? 0,
          },
          {
            suspendCurrent: true,
          },
        );
        return;
      }
      default:
        this.closeActiveOverlay(false);
    }
  }

  private async openInspectOverlay(): Promise<void> {
    const operatorRuntime = createOperatorRuntimePort(this.#bundle.runtime);
    const report = buildSessionInspectReport({
      runtime: operatorRuntime,
      sessionId: this.#sessionPort.getSessionId(),
      directory: resolveInspectDirectory(operatorRuntime, undefined, undefined),
    });
    const sections = buildInspectSections(report);
    this.openOverlay({
      kind: "inspect",
      lines: sections[0]?.lines ?? [],
      sections,
      selectedIndex: 0,
      scrollOffsets: sections.map(() => 0),
    });
  }

  private buildNotificationsOverlayPayload(
    selection: {
      id?: string;
      index?: number;
    } = {},
  ): CliNotificationsOverlayPayload {
    const notifications = this.#state.notifications.toReversed();
    const selectedIndexById =
      typeof selection.id === "string"
        ? notifications.findIndex((notification) => notification.id === selection.id)
        : -1;
    const selectedIndex =
      selectedIndexById >= 0
        ? selectedIndexById
        : Math.max(0, Math.min(selection.index ?? 0, Math.max(0, notifications.length - 1)));
    return {
      kind: "notifications",
      notifications,
      selectedIndex,
    };
  }

  private openNotificationsOverlay(): void {
    this.openOverlay(this.buildNotificationsOverlayPayload());
  }

  private buildSessionsOverlayPayload(
    snapshot: OperatorSurfaceSnapshot = this.#operatorSnapshot,
    selection: {
      sessionId?: string;
      index?: number;
    } = {},
  ): CliShellOverlayPayload {
    const currentSessionId = this.#sessionPort.getSessionId();
    const currentSession = snapshot.sessions.find(
      (session) => session.sessionId === currentSessionId,
    ) ?? {
      sessionId: currentSessionId,
      eventCount: 0,
      lastEventAt: 0,
    };
    const sessions = [
      currentSession,
      ...snapshot.sessions.filter((session) => session.sessionId !== currentSessionId),
    ];
    const selectedIndexById =
      typeof selection.sessionId === "string"
        ? sessions.findIndex((session) => session.sessionId === selection.sessionId)
        : -1;
    const fallbackCurrentIndex = sessions.findIndex(
      (session) => session.sessionId === currentSessionId,
    );
    const selectedIndex =
      selectedIndexById >= 0
        ? selectedIndexById
        : fallbackCurrentIndex >= 0
          ? fallbackCurrentIndex
          : Math.max(0, Math.min(selection.index ?? 0, Math.max(0, sessions.length - 1)));

    const draftStateBySessionId = Object.fromEntries(
      [...this.#draftsBySessionId.entries()].map(([sessionId, draft]) => [
        sessionId,
        summarizeDraftPreview(draft.text),
      ]),
    );

    const currentDraft = this.#state.composer.text;
    if (currentDraft.trim().length > 0) {
      draftStateBySessionId[currentSessionId] = summarizeDraftPreview(currentDraft);
    } else {
      delete draftStateBySessionId[currentSessionId];
    }

    return {
      kind: "sessions",
      selectedIndex,
      sessions,
      currentSessionId,
      draftStateBySessionId,
    };
  }

  private openSessionsOverlay(): void {
    this.openOverlay(this.buildSessionsOverlayPayload());
  }

  private syncNotificationsOverlay(): void {
    const active = this.#state.overlay.active?.payload;
    if (active?.kind !== "notifications") {
      return;
    }
    this.replaceActiveOverlay(
      this.buildNotificationsOverlayPayload({
        id: active.notifications[active.selectedIndex]?.id,
        index: active.selectedIndex,
      }),
    );
  }

  private async switchBundle(bundle: CliShellSessionBundle): Promise<void> {
    this.snapshotCurrentDraft();
    this.#bundle.session.dispose();
    this.mountSession(bundle);
    this.initializeState();
    this.ui.notify(
      `Session started: ${this.#sessionPort.getSessionId()} (${this.#sessionPort.getModelLabel()})`,
      "info",
    );
    await this.refreshOperatorSnapshot();
  }

  private snapshotCurrentDraft(): void {
    const sessionId = this.#sessionPort.getSessionId();
    const text = this.#state.composer.text;
    if (text.trim().length === 0) {
      this.#draftsBySessionId.delete(sessionId);
      return;
    }
    this.#draftsBySessionId.set(sessionId, {
      text,
      cursor: this.#state.composer.cursor,
      updatedAt: Date.now(),
    });
  }

  private async requestDialog<T>(request: {
    id: string;
    kind: "confirm" | "input" | "select";
    title: string;
    message?: string;
    options?: string[];
    resolve(value: T): void;
  }): Promise<T> {
    return await new Promise<T>((resolve) => {
      const payload =
        request.kind === "confirm"
          ? ({
              kind: "confirm",
              message: request.message ?? request.title,
              resolve: (value: boolean) => {
                request.resolve(value as T);
                resolve(value as T);
              },
            } satisfies CliShellOverlayPayload)
          : request.kind === "input"
            ? ({
                kind: "input",
                message: request.message,
                value: "",
                resolve: (value: string | undefined) => {
                  request.resolve(value as T);
                  resolve(value as T);
                },
              } satisfies CliShellOverlayPayload)
            : ({
                kind: "select",
                options: request.options ?? [],
                selectedIndex: 0,
                resolve: (value: string | undefined) => {
                  request.resolve(value as T);
                  resolve(value as T);
                },
              } satisfies CliShellOverlayPayload);
      this.openOverlay(payload, "queued");
    });
  }

  private async openExternalEditor(title: string, prefill?: string): Promise<string | undefined> {
    if (this.options.openExternalEditor) {
      return await this.options.openExternalEditor(title, prefill);
    }
    const editor = this.#configPort.getEditorCommand();
    if (!editor) {
      this.ui.notify("No VISUAL or EDITOR is configured.", "warning");
      return prefill;
    }
    return await openExternalEditorWithShell(editor, title, prefill);
  }

  private async openActivePagerExternally(): Promise<void> {
    const externalPagerTarget = this.getExternalPagerTarget("pager");
    if (!externalPagerTarget) {
      return;
    }
    await this.openExternalPagerTarget(externalPagerTarget);
  }

  private getExternalPagerTarget(
    filter?: "pager",
  ): { title: string; lines: readonly string[] } | undefined {
    const active = this.#state.overlay.active?.payload;
    if (!active) {
      return undefined;
    }
    if (active.kind === "pager") {
      return {
        title: active.title ?? "brewva-pager",
        lines: active.lines,
      };
    }
    if (filter === "pager") {
      return undefined;
    }
    if (active.kind === "inspect") {
      const section = active.sections[active.selectedIndex];
      if (!section) {
        return undefined;
      }
      return {
        title: section.title,
        lines: section.lines,
      };
    }
    if (active.kind === "tasks") {
      const run = active.snapshot.taskRuns[active.selectedIndex];
      if (!run) {
        return undefined;
      }
      const sessionWireFrames = run.workerSessionId
        ? this.#bundle.runtime.inspect.sessionWire?.query?.(run.workerSessionId)
        : undefined;
      return {
        title: `Task ${run.runId} output`,
        lines: buildTaskRunOutputLines(run, { sessionWireFrames }),
      };
    }
    if (active.kind === "notifications") {
      const notification = active.notifications[active.selectedIndex];
      if (!notification) {
        return undefined;
      }
      return {
        title: `Notification [${notification.level}]`,
        lines: [
          `id: ${notification.id}`,
          `level: ${notification.level}`,
          `createdAt: ${new Date(notification.createdAt).toISOString()}`,
          "",
          ...notification.message.split(/\r?\n/u),
        ],
      };
    }
    return undefined;
  }

  private async openExternalPagerTarget(target: {
    title: string;
    lines: readonly string[];
  }): Promise<void> {
    const opened = await this.openExternalPager(target.title, target.lines);
    if (!opened) {
      this.ui.notify("No external pager is available for the current shell.", "warning");
    }
  }

  private async openExternalPager(title: string, lines: readonly string[]): Promise<boolean> {
    if (this.options.openExternalPager) {
      return await this.options.openExternalPager(title, lines);
    }
    const pager = getExternalPagerCommand();
    if (!pager) {
      return false;
    }
    return await openExternalPagerWithShell(pager, title, lines);
  }
}

export function getTranscriptEntryBodyLines(
  entry: CliShellTranscriptEntry,
  width: number,
  mode: "stable" | "streaming" = "stable",
): string[] {
  return renderTranscriptEntryBodyLines(entry, width, mode);
}
