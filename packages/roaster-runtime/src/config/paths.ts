import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const ROASTER_CONFIG_DIR_RELATIVE = ".pi-roaster";
export const ROASTER_CONFIG_FILE_NAME = "roaster.json";

function normalizePathInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function resolveMaybeAbsolute(baseDir: string, pathText: string): string {
  const normalized = normalizePathInput(pathText);
  if (isAbsolute(normalized)) {
    return resolve(normalized);
  }
  return resolve(baseDir, normalized);
}

function resolveAgentDirFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const fromRoaster = typeof env["PI-ROASTER_CODING_AGENT_DIR"] === "string"
    ? env["PI-ROASTER_CODING_AGENT_DIR"]
    : "";
  if (fromRoaster.trim().length > 0) {
    return resolveMaybeAbsolute(process.cwd(), fromRoaster);
  }

  const fromPi = typeof env.PI_CODING_AGENT_DIR === "string" ? env.PI_CODING_AGENT_DIR : "";
  if (fromPi.trim().length > 0) {
    return resolveMaybeAbsolute(process.cwd(), fromPi);
  }

  return undefined;
}

export function resolveGlobalRoasterRootDir(env: NodeJS.ProcessEnv = process.env): string {
  const agentDirFromEnv = resolveAgentDirFromEnv(env);
  if (agentDirFromEnv) {
    return resolve(agentDirFromEnv, "..");
  }

  const configured = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME : "";
  if (configured.trim().length > 0) {
    return resolveMaybeAbsolute(process.cwd(), join(configured, "pi-roaster"));
  }
  return resolve(homedir(), ".config", "pi-roaster");
}

export function resolveProjectRoasterRootDir(cwd: string): string {
  return resolve(cwd, ROASTER_CONFIG_DIR_RELATIVE);
}

export function resolveRoasterConfigPathForRoot(rootDir: string): string {
  return join(rootDir, ROASTER_CONFIG_FILE_NAME);
}

export function resolveGlobalRoasterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveRoasterConfigPathForRoot(resolveGlobalRoasterRootDir(env));
}

export function resolveProjectRoasterConfigPath(cwd: string): string {
  return resolveRoasterConfigPathForRoot(resolveProjectRoasterRootDir(cwd));
}

export function resolveRoasterAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalRoasterRootDir(env), "agent");
}
