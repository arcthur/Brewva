import {
  ITERATION_CONVERGENCE_STATUS_VALUES,
  ITERATION_DECISION_VALUES,
  ITERATION_FACT_SESSION_SCOPE_VALUES,
  ITERATION_GUARD_STATUS_VALUES,
  ITERATION_METRIC_AGGREGATION_VALUES,
} from "@brewva/brewva-runtime";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { BrewvaToolOptions } from "./types.js";
import { buildStringEnumSchema } from "./utils/input-alias.js";
import { failTextResult, textResult } from "./utils/result.js";
import { getSessionId } from "./utils/session.js";
import { defineBrewvaTool } from "./utils/tool.js";

const ITERATION_ACTION_VALUES = [
  "record_metric",
  "record_guard",
  "record_decision",
  "record_convergence",
  "list",
] as const;

const IterationActionSchema = buildStringEnumSchema(ITERATION_ACTION_VALUES, {}, {});
const MetricAggregationSchema = buildStringEnumSchema(ITERATION_METRIC_AGGREGATION_VALUES, {}, {});
const GuardStatusSchema = buildStringEnumSchema(ITERATION_GUARD_STATUS_VALUES, {}, {});
const DecisionSchema = buildStringEnumSchema(ITERATION_DECISION_VALUES, {}, {});
const SessionScopeSchema = buildStringEnumSchema(ITERATION_FACT_SESSION_SCOPE_VALUES, {}, {});

function readMetricAggregation(
  value: unknown,
): (typeof ITERATION_METRIC_AGGREGATION_VALUES)[number] | undefined {
  return typeof value === "string" &&
    ITERATION_METRIC_AGGREGATION_VALUES.includes(
      value as (typeof ITERATION_METRIC_AGGREGATION_VALUES)[number],
    )
    ? (value as (typeof ITERATION_METRIC_AGGREGATION_VALUES)[number])
    : undefined;
}

function readGuardStatus(
  value: unknown,
): (typeof ITERATION_GUARD_STATUS_VALUES)[number] | undefined {
  return typeof value === "string" &&
    ITERATION_GUARD_STATUS_VALUES.includes(value as (typeof ITERATION_GUARD_STATUS_VALUES)[number])
    ? (value as (typeof ITERATION_GUARD_STATUS_VALUES)[number])
    : undefined;
}

function readDecision(value: unknown): (typeof ITERATION_DECISION_VALUES)[number] | undefined {
  return typeof value === "string" &&
    ITERATION_DECISION_VALUES.includes(value as (typeof ITERATION_DECISION_VALUES)[number])
    ? (value as (typeof ITERATION_DECISION_VALUES)[number])
    : undefined;
}

function readConvergenceStatus(
  value: unknown,
): (typeof ITERATION_CONVERGENCE_STATUS_VALUES)[number] | undefined {
  return typeof value === "string" &&
    ITERATION_CONVERGENCE_STATUS_VALUES.includes(
      value as (typeof ITERATION_CONVERGENCE_STATUS_VALUES)[number],
    )
    ? (value as (typeof ITERATION_CONVERGENCE_STATUS_VALUES)[number])
    : undefined;
}

function readSessionScope(
  value: unknown,
): (typeof ITERATION_FACT_SESSION_SCOPE_VALUES)[number] | undefined {
  return typeof value === "string" &&
    ITERATION_FACT_SESSION_SCOPE_VALUES.includes(
      value as (typeof ITERATION_FACT_SESSION_SCOPE_VALUES)[number],
    )
    ? (value as (typeof ITERATION_FACT_SESSION_SCOPE_VALUES)[number])
    : undefined;
}

function joinRefs(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatMetricRecord(record: {
  eventId: string;
  metricKey: string;
  value: number;
  unit?: string;
  aggregation?: string;
  iterationKey?: string;
  source: string;
}): string {
  const valueText = record.unit ? `${record.value} ${record.unit}` : String(record.value);
  const aggregation = record.aggregation ? ` aggregation=${record.aggregation}` : "";
  const iteration = record.iterationKey ? ` iteration=${record.iterationKey}` : "";
  return `- metric event=${record.eventId} key=${record.metricKey} value=${valueText}${aggregation}${iteration} source=${record.source}`;
}

function formatGuardRecord(record: {
  eventId: string;
  guardKey: string;
  status: string;
  iterationKey?: string;
  source: string;
}): string {
  const iteration = record.iterationKey ? ` iteration=${record.iterationKey}` : "";
  return `- guard event=${record.eventId} key=${record.guardKey} status=${record.status}${iteration} source=${record.source}`;
}

function formatDecisionRecord(record: {
  eventId: string;
  iterationKey: string;
  decision: string;
  reasonCode: string;
  source: string;
}): string {
  return `- decision event=${record.eventId} iteration=${record.iterationKey} decision=${record.decision} reason=${record.reasonCode} source=${record.source}`;
}

function formatConvergenceRecord(record: {
  eventId: string;
  runKey: string;
  status: string;
  reasonCode: string;
  source: string;
}): string {
  return `- convergence event=${record.eventId} run=${record.runKey} status=${record.status} reason=${record.reasonCode} source=${record.source}`;
}

export function createIterationFactTool(options: BrewvaToolOptions): ToolDefinition {
  return defineBrewvaTool({
    name: "iteration_fact",
    label: "Iteration Fact",
    description:
      "Record or inspect durable iteration facts such as metric observations, guard results, iteration decisions, and convergence reasons.",
    promptSnippet:
      "Use this to persist objective iteration facts or inspect recent fact history without inventing a planner state machine.",
    promptGuidelines: [
      "Record only objective facts: measured values, guard outcomes, explicit keep/discard decisions, or explicit convergence and escalation reasons.",
      "Do not use this tool to script the next step or encode hidden chain-of-thought.",
    ],
    parameters: Type.Object({
      action: IterationActionSchema,
      metric_key: Type.Optional(Type.String()),
      value: Type.Optional(Type.Number()),
      unit: Type.Optional(Type.String()),
      aggregation: Type.Optional(MetricAggregationSchema),
      sample_count: Type.Optional(Type.Integer({ minimum: 1 })),
      guard_key: Type.Optional(Type.String()),
      status: Type.Optional(GuardStatusSchema),
      iteration_key: Type.Optional(Type.String()),
      decision: Type.Optional(DecisionSchema),
      reason_code: Type.Optional(Type.String()),
      run_key: Type.Optional(Type.String()),
      predicate_ref: Type.Optional(Type.String()),
      source: Type.Optional(Type.String()),
      evidence_refs: Type.Optional(Type.Array(Type.String())),
      metric_observation_refs: Type.Optional(Type.Array(Type.String())),
      guard_result_refs: Type.Optional(Type.Array(Type.String())),
      rollback_receipt_ref: Type.Optional(Type.String()),
      mutation_receipt_ref: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      history_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      session_scope: Type.Optional(SessionScopeSchema),
      fact_kind: Type.Optional(
        buildStringEnumSchema(
          ["metric", "guard", "decision", "convergence", "all"] as const,
          {},
          { recommendedValue: "all" },
        ),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = getSessionId(ctx);
      const source = params.source?.trim() || "iteration_fact";
      const aggregation = readMetricAggregation(params.aggregation);
      const guardStatus = readGuardStatus(params.status);
      const decision = readDecision(params.decision);
      const convergenceStatus = readConvergenceStatus(params.status);
      const sessionScope = readSessionScope(params.session_scope);

      if (params.action === "record_metric") {
        if (!params.metric_key?.trim() || typeof params.value !== "number") {
          return failTextResult("Metric recording requires metric_key and value.", {
            ok: false,
            error: "missing_metric_fields",
          });
        }
        const event = options.runtime.events.recordMetricObservation(sessionId, {
          metricKey: params.metric_key,
          value: params.value,
          unit: params.unit,
          aggregation,
          sampleCount: params.sample_count,
          iterationKey: params.iteration_key,
          evidenceRefs: params.evidence_refs,
          source,
          summary: params.summary,
        });
        if (!event) {
          return failTextResult("Metric observation was not recorded.", {
            ok: false,
            error: "record_failed",
          });
        }
        const record = options.runtime.events.listMetricObservations(sessionId, {
          last: 1,
          metricKey: params.metric_key,
          source,
        })[0];
        return textResult(`Metric observation recorded (${event.id}).`, {
          ok: true,
          eventId: event.id,
          record: record ?? null,
        });
      }

      if (params.action === "record_guard") {
        if (!params.guard_key?.trim() || !guardStatus) {
          return failTextResult("Guard recording requires guard_key and status.", {
            ok: false,
            error: "missing_guard_fields",
          });
        }
        const event = options.runtime.events.recordGuardResult(sessionId, {
          guardKey: params.guard_key,
          status: guardStatus,
          iterationKey: params.iteration_key,
          evidenceRefs: params.evidence_refs,
          source,
          summary: params.summary,
        });
        if (!event) {
          return failTextResult("Guard result was not recorded.", {
            ok: false,
            error: "record_failed",
          });
        }
        const record = options.runtime.events.listGuardResults(sessionId, {
          last: 1,
          guardKey: params.guard_key,
          source,
        })[0];
        return textResult(`Guard result recorded (${event.id}).`, {
          ok: true,
          eventId: event.id,
          record: record ?? null,
        });
      }

      if (params.action === "record_decision") {
        if (!params.iteration_key?.trim() || !decision || !params.reason_code?.trim()) {
          return failTextResult(
            "Decision recording requires iteration_key, decision, and reason_code.",
            {
              ok: false,
              error: "missing_decision_fields",
            },
          );
        }
        const event = options.runtime.events.recordIterationDecision(sessionId, {
          iterationKey: params.iteration_key,
          decision,
          reasonCode: params.reason_code,
          metricObservationRefs: params.metric_observation_refs,
          guardResultRefs: params.guard_result_refs,
          rollbackReceiptRef: params.rollback_receipt_ref,
          mutationReceiptRef: params.mutation_receipt_ref,
          source,
          summary: params.summary,
        });
        if (!event) {
          return failTextResult("Iteration decision was not recorded.", {
            ok: false,
            error: "record_failed",
          });
        }
        const record = options.runtime.events.listIterationDecisions(sessionId, {
          last: 1,
          iterationKey: params.iteration_key,
          source,
        })[0];
        return textResult(`Iteration decision recorded (${event.id}).`, {
          ok: true,
          eventId: event.id,
          record: record ?? null,
        });
      }

      if (params.action === "record_convergence") {
        if (!params.run_key?.trim() || !convergenceStatus || !params.reason_code?.trim()) {
          return failTextResult(
            "Convergence recording requires run_key, status, and reason_code.",
            {
              ok: false,
              error: "missing_convergence_fields",
            },
          );
        }
        const event = options.runtime.events.recordConvergenceReason(sessionId, {
          runKey: params.run_key,
          status: convergenceStatus,
          reasonCode: params.reason_code,
          predicateRef: params.predicate_ref,
          evidenceRefs: params.evidence_refs,
          source,
          summary: params.summary,
        });
        if (!event) {
          return failTextResult("Convergence reason was not recorded.", {
            ok: false,
            error: "record_failed",
          });
        }
        const record = options.runtime.events.listConvergenceReasons(sessionId, {
          last: 1,
          runKey: params.run_key,
          source,
        })[0];
        return textResult(`Convergence reason recorded (${event.id}).`, {
          ok: true,
          eventId: event.id,
          record: record ?? null,
        });
      }

      const historyLimit = Math.max(1, Math.min(50, params.history_limit ?? 10));
      const factKind = params.fact_kind ?? "all";
      const lines = ["[IterationFacts]"];
      const details: Record<string, unknown> = {};

      if (factKind === "metric" || factKind === "all") {
        const metrics = options.runtime.events.listMetricObservations(sessionId, {
          last: historyLimit,
          iterationKey: params.iteration_key,
          metricKey: params.metric_key,
          source: params.source,
          sessionScope,
        });
        lines.push(`metrics: ${metrics.length}`);
        for (const record of metrics) {
          lines.push(formatMetricRecord(record));
        }
        details.metrics = metrics;
      }

      if (factKind === "guard" || factKind === "all") {
        const guards = options.runtime.events.listGuardResults(sessionId, {
          last: historyLimit,
          iterationKey: params.iteration_key,
          guardKey: params.guard_key,
          status: guardStatus,
          source: params.source,
          sessionScope,
        });
        lines.push(`guards: ${guards.length}`);
        for (const record of guards) {
          lines.push(formatGuardRecord(record));
        }
        details.guards = guards;
      }

      if (factKind === "decision" || factKind === "all") {
        const decisions = options.runtime.events.listIterationDecisions(sessionId, {
          last: historyLimit,
          iterationKey: params.iteration_key,
          decision,
          reasonCode: params.reason_code,
          source: params.source,
          sessionScope,
        });
        lines.push(`decisions: ${decisions.length}`);
        for (const record of decisions) {
          lines.push(formatDecisionRecord(record));
        }
        details.decisions = decisions;
      }

      if (factKind === "convergence" || factKind === "all") {
        const convergence = options.runtime.events.listConvergenceReasons(sessionId, {
          last: historyLimit,
          runKey: params.run_key,
          status: convergenceStatus,
          reasonCode: params.reason_code,
          source: params.source,
          sessionScope,
        });
        lines.push(`convergence: ${convergence.length}`);
        for (const record of convergence) {
          lines.push(formatConvergenceRecord(record));
        }
        details.convergence = convergence;
      }

      if (params.metric_observation_refs?.length) {
        lines.push(`metric_observation_refs: ${joinRefs(params.metric_observation_refs)}`);
      }
      if (params.guard_result_refs?.length) {
        lines.push(`guard_result_refs: ${joinRefs(params.guard_result_refs)}`);
      }
      if (sessionScope) {
        lines.push(`session_scope: ${sessionScope}`);
      }

      return textResult(lines.join("\n"), {
        ok: true,
        ...details,
      });
    },
  });
}
