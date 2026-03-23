import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PlaneSessionDigest {
  sessionId: string;
  eventCount: number;
  lastEventAt: number;
}

interface EventLike {
  timestamp: number;
}

interface EventStoreLike<TEvent extends EventLike = EventLike> {
  list(sessionId: string): readonly TEvent[];
  listSessionIds(): readonly string[];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function collectPlaneSessionDigests<TEvent extends EventLike>(
  events: EventStoreLike<TEvent>,
): PlaneSessionDigest[] {
  return events
    .listSessionIds()
    .map((sessionId) => {
      const sessionEvents = events.list(sessionId);
      return {
        sessionId,
        eventCount: sessionEvents.length,
        lastEventAt: sessionEvents[sessionEvents.length - 1]?.timestamp ?? 0,
      };
    })
    .filter((entry) => entry.eventCount > 0)
    .toSorted((left, right) => left.sessionId.localeCompare(right.sessionId));
}

export function samePlaneSessionDigests(
  left: readonly PlaneSessionDigest[],
  right: readonly PlaneSessionDigest[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (
      a.sessionId !== b.sessionId ||
      a.eventCount !== b.eventCount ||
      a.lastEventAt !== b.lastEventAt
    ) {
      return false;
    }
  }
  return true;
}

export function shouldThrottlePlaneRefresh(input: {
  currentUpdatedAt?: number;
  dirty: boolean;
  digestsChanged: boolean;
  minRefreshIntervalMs?: number;
  now: number;
}): boolean {
  const minRefreshIntervalMs = input.minRefreshIntervalMs;
  if (!input.dirty || input.digestsChanged) return false;
  if (!minRefreshIntervalMs || minRefreshIntervalMs <= 0) return false;
  if (input.currentUpdatedAt === undefined) return false;
  return input.now - input.currentUpdatedAt < minRefreshIntervalMs;
}

export function writeFileAtomic(filePath: string, content: string): void {
  const resolvedPath = resolve(filePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const tmpPath = `${resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, resolvedPath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // best effort
    }
    throw error;
  }
}
