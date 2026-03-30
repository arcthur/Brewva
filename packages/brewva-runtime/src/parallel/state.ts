import type { BrewvaEventRecord } from "../contracts/index.js";
import { isDelegationRunTerminalStatus, type DelegationRunStatus } from "../contracts/index.js";
import {
  SUBAGENT_CANCELLED_EVENT_TYPE,
  SUBAGENT_COMPLETED_EVENT_TYPE,
  SUBAGENT_FAILED_EVENT_TYPE,
  SUBAGENT_RUNNING_EVENT_TYPE,
  SUBAGENT_SPAWNED_EVENT_TYPE,
  WORKER_RESULTS_APPLIED_EVENT_TYPE,
} from "../events/event-types.js";

export interface DerivedParallelBudgetState {
  activeRunIds: string[];
  totalStarted: number;
  latestEventId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRunStatus(value: unknown): DelegationRunStatus | undefined {
  return value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "timeout" ||
    value === "cancelled" ||
    value === "merged"
    ? value
    : undefined;
}

function readWorkerIds(payload: Record<string, unknown> | undefined): string[] {
  const collected = new Set<string>();
  const singleWorkerId = readString(payload?.workerId);
  if (singleWorkerId) {
    collected.add(singleWorkerId);
  }
  if (Array.isArray(payload?.workerIds)) {
    for (const value of payload.workerIds) {
      const workerId = readString(value);
      if (workerId) {
        collected.add(workerId);
      }
    }
  }
  return [...collected];
}

export function deriveParallelBudgetStateFromEvents(
  events: readonly BrewvaEventRecord[],
): DerivedParallelBudgetState {
  const started = new Set<string>();
  const active = new Set<string>();

  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    if (event.type === WORKER_RESULTS_APPLIED_EVENT_TYPE) {
      for (const workerId of readWorkerIds(payload)) {
        active.delete(workerId);
      }
      continue;
    }

    if (
      event.type !== SUBAGENT_SPAWNED_EVENT_TYPE &&
      event.type !== SUBAGENT_RUNNING_EVENT_TYPE &&
      event.type !== SUBAGENT_COMPLETED_EVENT_TYPE &&
      event.type !== SUBAGENT_FAILED_EVENT_TYPE &&
      event.type !== SUBAGENT_CANCELLED_EVENT_TYPE
    ) {
      continue;
    }

    const runId = readString(payload?.runId);
    if (!runId) {
      continue;
    }

    started.add(runId);
    if (event.type === SUBAGENT_RUNNING_EVENT_TYPE) {
      active.add(runId);
      continue;
    }

    if (event.type === SUBAGENT_SPAWNED_EVENT_TYPE) {
      const status = readRunStatus(payload?.status) ?? "pending";
      if (!isDelegationRunTerminalStatus(status)) {
        active.add(runId);
      } else {
        active.delete(runId);
      }
      continue;
    }

    active.delete(runId);
  }

  return {
    activeRunIds: [...active],
    totalStarted: started.size,
    latestEventId: events[events.length - 1]?.id,
  };
}
