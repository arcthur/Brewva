import { describe, expect, test } from "bun:test";
import { resolveThreadLoopProfile } from "../../../packages/brewva-gateway/src/session/thread-loop-profiles.js";
import { createMinimalThreadLoopDiagnostic } from "../../../packages/brewva-gateway/src/session/thread-loop-types.js";

describe("thread loop diagnostics", () => {
  test("builds a typed minimal diagnostic view for synthetic loop results", () => {
    const profile = resolveThreadLoopProfile({ source: "interactive" });

    expect(
      createMinimalThreadLoopDiagnostic({
        sessionId: "session-1",
        turnId: "turn-1",
        profile,
      }),
    ).toEqual({
      sessionId: "session-1",
      turnId: "turn-1",
      profile: "interactive",
      attemptSequence: 1,
      compactAttempts: 0,
      recoveryHistory: [],
      compaction: {
        requestedGeneration: 0,
        completedGeneration: 0,
        foregroundOwner: false,
      },
    });
  });
});
