import type { BrewvaRuntime } from "@brewva/brewva-runtime";
import { recordRuntimeEvent } from "@brewva/brewva-runtime/internal";

export function clampText(value: string, maxChars: number): string;
export function clampText(value: string | undefined, maxChars: number): string | undefined;
export function clampText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function ensureSessionShutdownRecorded(runtime: BrewvaRuntime, sessionId: string): void {
  if (runtime.inspect.events.query(sessionId, { type: "session_shutdown", last: 1 }).length > 0)
    return;
  recordRuntimeEvent(runtime, {
    sessionId,
    type: "session_shutdown",
  });
}
