import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileAtomic } from "./plane-substrate.js";
import {
  DELIBERATION_MEMORY_ARTIFACT_KINDS,
  DELIBERATION_MEMORY_SCOPE_VALUES,
  DELIBERATION_MEMORY_STATE_SCHEMA,
  type DeliberationMemoryArtifact,
  type DeliberationMemoryEvidenceRef,
  type DeliberationMemorySessionDigest,
  type DeliberationMemoryState,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry) ?? "").filter((entry) => entry.length > 0);
}

function readEvidence(value: unknown): DeliberationMemoryEvidenceRef | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = readString(value.sessionId);
  const eventId = readString(value.eventId);
  const eventType = readString(value.eventType);
  const timestamp = readNumber(value.timestamp);
  if (!sessionId || !eventId || !eventType || timestamp === undefined) {
    return undefined;
  }
  return {
    sessionId,
    eventId,
    eventType,
    timestamp,
  };
}

function readArtifact(value: unknown): DeliberationMemoryArtifact | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  const kind = readString(value.kind);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const content = readString(value.content);
  const confidenceScore = readNumber(value.confidenceScore);
  const firstCapturedAt = readNumber(value.firstCapturedAt);
  const lastValidatedAt = readNumber(value.lastValidatedAt);
  const applicabilityScope = readString(value.applicabilityScope);
  if (
    !id ||
    !kind ||
    !title ||
    !summary ||
    !content ||
    confidenceScore === undefined ||
    firstCapturedAt === undefined ||
    lastValidatedAt === undefined ||
    !applicabilityScope
  ) {
    return undefined;
  }
  if (
    !DELIBERATION_MEMORY_ARTIFACT_KINDS.includes(
      kind as (typeof DELIBERATION_MEMORY_ARTIFACT_KINDS)[number],
    )
  ) {
    return undefined;
  }
  if (
    !DELIBERATION_MEMORY_SCOPE_VALUES.includes(
      applicabilityScope as (typeof DELIBERATION_MEMORY_SCOPE_VALUES)[number],
    )
  ) {
    return undefined;
  }
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map((entry) => readEvidence(entry))
        .filter((entry): entry is DeliberationMemoryEvidenceRef => Boolean(entry))
    : [];
  const sessionIds = readStringArray(value.sessionIds);
  const tags = readStringArray(value.tags);
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  return {
    id,
    kind: kind as DeliberationMemoryArtifact["kind"],
    title,
    summary,
    content,
    confidenceScore,
    firstCapturedAt,
    lastValidatedAt,
    applicabilityScope: applicabilityScope as (typeof DELIBERATION_MEMORY_SCOPE_VALUES)[number],
    evidence,
    sessionIds,
    tags,
    metadata,
  };
}

function readSessionDigest(value: unknown): DeliberationMemorySessionDigest | undefined {
  if (!isRecord(value)) return undefined;
  const sessionId = readString(value.sessionId);
  const eventCount = readNumber(value.eventCount);
  const lastEventAt = readNumber(value.lastEventAt);
  if (!sessionId || eventCount === undefined || lastEventAt === undefined) {
    return undefined;
  }
  return {
    sessionId,
    eventCount,
    lastEventAt,
  };
}

function normalizeState(value: unknown): DeliberationMemoryState | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schema !== DELIBERATION_MEMORY_STATE_SCHEMA) return undefined;
  const updatedAt = readNumber(value.updatedAt);
  if (updatedAt === undefined) return undefined;
  const artifacts = Array.isArray(value.artifacts)
    ? value.artifacts
        .map((entry) => readArtifact(entry))
        .filter((entry): entry is DeliberationMemoryArtifact => Boolean(entry))
    : [];
  const sessionDigests = Array.isArray(value.sessionDigests)
    ? value.sessionDigests
        .map((entry) => readSessionDigest(entry))
        .filter((entry): entry is DeliberationMemorySessionDigest => Boolean(entry))
    : [];
  return {
    schema: DELIBERATION_MEMORY_STATE_SCHEMA,
    updatedAt,
    artifacts,
    sessionDigests,
  };
}

export function resolveDeliberationMemoryStatePath(workspaceRoot: string): string {
  return resolve(workspaceRoot, ".brewva", "deliberation", "memory-state.json");
}

export class FileDeliberationMemoryStore {
  readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = resolveDeliberationMemoryStatePath(workspaceRoot);
  }

  read(): DeliberationMemoryState | undefined {
    if (!existsSync(this.filePath)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return normalizeState(parsed);
    } catch {
      return undefined;
    }
  }

  write(state: DeliberationMemoryState): void {
    writeFileAtomic(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
