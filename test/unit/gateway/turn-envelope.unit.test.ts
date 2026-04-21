import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrewvaRuntime,
  asBrewvaToolCallId,
  asBrewvaToolName,
  type SessionWireFrame,
  type ToolOutputView,
} from "@brewva/brewva-runtime";
import type { BrewvaPromptContentPart } from "@brewva/brewva-substrate";
import {
  runHostedTurnEnvelope,
  type HostedTurnEnvelopeLoopResult,
} from "../../../packages/brewva-gateway/src/session/turn-envelope.js";

function createRuntime(prefix: string): BrewvaRuntime {
  return new BrewvaRuntime({
    cwd: mkdtempSync(join(tmpdir(), prefix)),
  });
}

function eventTypes(runtime: BrewvaRuntime, sessionId: string): string[] {
  return runtime.inspect.events.list(sessionId).map((event) => event.type);
}

function eventPayloads(runtime: BrewvaRuntime, sessionId: string, type: string): unknown[] {
  return runtime.inspect.events.list(sessionId, { type }).map((event) => event.payload);
}

function createLoopResult(
  input?: Partial<Extract<HostedTurnEnvelopeLoopResult, { status: "completed" }>>,
): HostedTurnEnvelopeLoopResult {
  return {
    status: "completed",
    attemptId: input?.attemptId ?? "attempt-1",
    assistantText: input?.assistantText ?? "done",
    toolOutputs: input?.toolOutputs ?? [],
    diagnostic: {
      sessionId: "unused",
      profile: "interactive",
      attemptSequence: 1,
      compactAttempts: 0,
      recoveryHistory: [],
      compaction: {
        requestedGeneration: 0,
        completedGeneration: 0,
        foregroundOwner: false,
      },
    },
  };
}

const emptySession = {
  sessionManager: {
    getSessionId: () => "unused",
  },
};

describe("hosted turn envelope", () => {
  test("records accepted input and terminal render around a completed gateway turn", async () => {
    const runtime = createRuntime("brewva-turn-envelope-gateway-");
    const sessionId = "session-envelope-gateway";
    const observedFrames: SessionWireFrame[] = [];

    const result = await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "hello",
      source: "gateway",
      turnId: "turn-gateway-1",
      onFrame: (frame) => observedFrames.push(frame),
      runLoop: async (_input) => createLoopResult({ assistantText: "gateway done" }),
    });

    expect(result.status).toBe("completed");
    expect(result.turnId).toBe("turn-gateway-1");
    expect(result.runtimeTurn).toBe(0);
    expect(eventTypes(runtime, sessionId)).toContain("turn_input_recorded");
    expect(eventPayloads(runtime, sessionId, "turn_input_recorded")[0]).toMatchObject({
      turnId: "turn-gateway-1",
      trigger: "user",
      promptText: "hello",
    });
    expect(eventPayloads(runtime, sessionId, "turn_render_committed")[0]).toMatchObject({
      turnId: "turn-gateway-1",
      attemptId: "attempt-1",
      status: "completed",
      assistantText: "gateway done",
      toolOutputs: [],
    });
    expect(observedFrames.map((frame) => frame.type)).toEqual(["turn.input", "turn.committed"]);
  });

  test("generates a stable turn id from the runtime turn when omitted", async () => {
    const runtime = createRuntime("brewva-turn-envelope-generated-");
    const sessionId = "session-envelope-generated";

    const result = await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: [{ type: "text", text: "first generated" }],
      source: "print",
      runLoop: async () => createLoopResult(),
    });

    expect(result.turnId).toBe("turn-0");
    expect(eventPayloads(runtime, sessionId, "turn_input_recorded")[0]).toMatchObject({
      turnId: "turn-0",
      trigger: "user",
      promptText: "first generated",
    });
  });

  test("applies schedule trigger continuity before running the loop", async () => {
    const runtime = createRuntime("brewva-turn-envelope-schedule-");
    const sessionId = "session-envelope-schedule";
    const observedGoal: string[] = [];

    await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "scheduled work",
      source: "schedule",
      turnId: "turn-schedule-1",
      trigger: {
        kind: "schedule",
        continuityMode: "inherit",
        taskSpec: {
          schema: "brewva.task.v1",
          goal: "Inherited schedule goal",
        },
        truthFacts: [
          {
            id: "fact-1",
            kind: "constraint",
            severity: "info",
            summary: "Inherited fact",
            status: "active",
            evidenceIds: [],
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ],
      },
      runLoop: async () => {
        observedGoal.push(runtime.inspect.task.getState(sessionId).spec?.goal ?? "");
        return createLoopResult();
      },
    });

    expect(observedGoal).toEqual(["Inherited schedule goal"]);
    expect(runtime.inspect.truth.getState(sessionId).facts.map((fact) => fact.id)).toContain(
      "fact-1",
    );
    expect(eventPayloads(runtime, sessionId, "turn_input_recorded")[0]).toMatchObject({
      trigger: "schedule",
    });
  });

  test("records schedule skill activation warning before running the loop", async () => {
    const runtime = createRuntime("brewva-turn-envelope-schedule-warning-");
    const sessionId = "session-envelope-schedule-warning";

    await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "scheduled skill work",
      source: "schedule",
      turnId: "turn-schedule-warning-1",
      trigger: {
        kind: "schedule",
        continuityMode: "inherit",
        activeSkillName: "missing-skill",
      },
      runLoop: async () => createLoopResult(),
    });

    expect(eventPayloads(runtime, sessionId, "schedule_trigger_apply_warning")[0]).toMatchObject({
      warning: "skill_activation_failed",
      skillName: "missing-skill",
    });
  });

  test("records WAL recovery transitions around recovered turns", async () => {
    const runtime = createRuntime("brewva-turn-envelope-wal-");
    const sessionId = "session-envelope-wal";

    await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "recover",
      source: "gateway",
      turnId: "turn-recovery-1",
      walReplayId: "wal-1",
      runLoop: async () => createLoopResult(),
    });

    expect(eventPayloads(runtime, sessionId, "turn_input_recorded")[0]).toMatchObject({
      trigger: "recovery",
    });
    expect(eventPayloads(runtime, sessionId, "session_turn_transition")).toEqual([
      expect.objectContaining({
        reason: "wal_recovery_resume",
        status: "entered",
        sourceEventId: "wal-1",
      }),
      expect.objectContaining({
        reason: "wal_recovery_resume",
        status: "completed",
        sourceEventId: "wal-1",
      }),
    ]);
  });

  test("records failed WAL transition and failed render when loop throws", async () => {
    const runtime = createRuntime("brewva-turn-envelope-wal-fail-");
    const sessionId = "session-envelope-wal-fail";

    const result = await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "recover fail",
      source: "gateway",
      turnId: "turn-recovery-fail-1",
      walReplayId: "wal-fail-1",
      runLoop: async () => {
        throw new Error("loop failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(eventPayloads(runtime, sessionId, "session_turn_transition")).toEqual([
      expect.objectContaining({
        reason: "wal_recovery_resume",
        status: "entered",
      }),
      expect.objectContaining({
        reason: "wal_recovery_resume",
        status: "failed",
        error: "loop failed",
      }),
    ]);
    expect(eventPayloads(runtime, sessionId, "turn_render_committed")[0]).toMatchObject({
      status: "failed",
      assistantText: "",
      toolOutputs: [],
    });
  });

  test("does not commit a terminal render for approval suspension", async () => {
    const runtime = createRuntime("brewva-turn-envelope-suspended-");
    const sessionId = "session-envelope-suspended";

    const result = await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "approval",
      source: "interactive",
      turnId: "turn-suspended-1",
      runLoop: async () => ({
        status: "suspended",
        reason: "approval",
        sourceEventId: "approval-event-1",
        diagnostic: {
          sessionId,
          profile: "interactive",
          attemptSequence: 1,
          compactAttempts: 0,
          recoveryHistory: [],
          compaction: {
            requestedGeneration: 0,
            completedGeneration: 0,
            foregroundOwner: false,
          },
        },
      }),
    });

    expect(result.status).toBe("suspended");
    expect(eventTypes(runtime, sessionId)).toContain("turn_input_recorded");
    expect(eventPayloads(runtime, sessionId, "turn_render_committed")).toEqual([]);
  });

  test("records cancelled terminal render when classifier marks thrown error as cancelled", async () => {
    const runtime = createRuntime("brewva-turn-envelope-cancelled-");
    const sessionId = "session-envelope-cancelled";

    const result = await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: "cancel me",
      source: "gateway",
      turnId: "turn-cancelled-1",
      classifyThrownError: () => "cancelled",
      runLoop: async () => {
        throw new Error("cancelled by user");
      },
    });

    expect(result.status).toBe("cancelled");
    expect(eventPayloads(runtime, sessionId, "turn_render_committed")[0]).toMatchObject({
      status: "cancelled",
      assistantText: "",
      toolOutputs: [],
    });
  });

  test("records subagent trigger for subagent source turns", async () => {
    const runtime = createRuntime("brewva-turn-envelope-subagent-");
    const sessionId = "session-envelope-subagent";
    const toolOutput: ToolOutputView = {
      toolCallId: asBrewvaToolCallId("tool-1"),
      toolName: asBrewvaToolName("read_file"),
      verdict: "pass",
      isError: false,
      text: "ok",
    };

    await runHostedTurnEnvelope({
      session: emptySession as Parameters<typeof runHostedTurnEnvelope>[0]["session"],
      runtime,
      sessionId,
      prompt: [{ type: "text", text: "child work" }] satisfies readonly BrewvaPromptContentPart[],
      source: "subagent",
      turnId: "turn-subagent-1",
      runLoop: async () =>
        createLoopResult({
          assistantText: "child done",
          toolOutputs: [toolOutput],
        }),
    });

    expect(eventPayloads(runtime, sessionId, "turn_input_recorded")[0]).toMatchObject({
      trigger: "subagent",
      promptText: "child work",
    });
    expect(eventPayloads(runtime, sessionId, "turn_render_committed")[0]).toMatchObject({
      status: "completed",
      assistantText: "child done",
      toolOutputs: [toolOutput],
    });
  });
});
