import { describe, expect, test } from "bun:test";
import type { BrewvaReplaySession, SessionWireFrame } from "@brewva/brewva-runtime";
import type { BrewvaToolUiPort } from "@brewva/brewva-substrate";
import {
  createOpenTuiElement,
  openTuiAct,
  openTuiTestRender,
} from "@brewva/brewva-tui/internal-opentui-runtime";
import { BrewvaOpenTuiShell } from "../../../packages/brewva-cli/runtime/opentui-shell.js";
import { CliShellController } from "../../../packages/brewva-cli/src/tui-app/controller.js";
import type { CliShellSessionBundle } from "../../../packages/brewva-cli/src/tui-app/types.js";

function createFakeBundle(
  options: {
    approvals?: number;
    seedMessages?: unknown[];
    sessionId?: string;
    replaySessions?: BrewvaReplaySession[];
    sessionWireBySessionId?: Record<string, SessionWireFrame[]>;
  } = {},
) {
  let attachedUi: BrewvaToolUiPort | undefined;
  const approvals = Array.from({ length: options.approvals ?? 0 }, (_, index) => ({
    requestId: `approval-${index + 1}`,
    proposalId: `proposal-${index + 1}`,
    toolName: "write_file",
    toolCallId: `tool-call-${index + 1}`,
    subject: `write file ${index + 1}`,
    boundary: "effectful",
    effects: ["workspace_write"],
    argsDigest: `digest-${index + 1}`,
    evidenceRefs: [],
    turn: index + 1,
    createdAt: Date.now(),
  }));
  const sessionId = options.sessionId ?? "session-1";
  const replaySessions = options.replaySessions ?? [
    {
      sessionId,
      eventCount: 1,
      lastEventAt: Date.now(),
    },
  ];

  const session = {
    model: {
      provider: "openai",
      id: "gpt-5.4-mini",
    },
    thinkingLevel: "high",
    isStreaming: false,
    sessionManager: {
      getSessionId() {
        return sessionId;
      },
      buildSessionContext() {
        return { messages: options.seedMessages ?? [] };
      },
    },
    subscribe() {
      return () => undefined;
    },
    async prompt() {},
    async waitForIdle() {},
    async abort() {},
    dispose() {},
    setUiPort(ui: BrewvaToolUiPort) {
      attachedUi = ui;
    },
  };

  const bundle = {
    session,
    runtime: {
      authority: {
        proposals: {
          decideEffectCommitment() {},
        },
      },
      inspect: {
        proposals: {
          listPendingEffectCommitments() {
            return approvals;
          },
        },
        events: {
          query() {
            return [];
          },
          listReplaySessions() {
            return replaySessions;
          },
        },
        sessionWire: {
          query(targetSessionId: string) {
            return options.sessionWireBySessionId?.[targetSessionId] ?? [];
          },
        },
      },
    },
  } as unknown as CliShellSessionBundle;

  return {
    bundle,
    getAttachedUi: () => attachedUi,
  };
}

function findFrameLineIndex(frame: string, needle: string): number {
  return frame.split("\n").findIndex((line) => line.includes(needle));
}

describe("opentui shell runtime", () => {
  test("renders transcript, notifications, and slash completion inside the OpenTUI shell", async () => {
    const { bundle } = createFakeBundle({
      seedMessages: [
        {
          role: "assistant",
          content: "Hello from Brewva",
        },
      ],
    });

    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    controller.ui.notify("Heads up", "warning");
    controller.ui.setEditorText("/ins");
    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 36,
      },
    );

    try {
      await openTuiAct(async () => {
        await Bun.sleep(CliShellController.STATUS_DEBOUNCE_MS + 20);
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Brewva:");
      expect(frame).toContain("Hello from Brewva");
      expect(frame).toContain("warning");
      expect(frame).toContain("Heads");
      expect(frame).toContain("Completions (slash)");
      expect(frame).toContain("/ins");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("routes global semantic keybindings through the OpenTUI keyboard transport", async () => {
    const { bundle } = createFakeBundle({ approvals: 1 });
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      await openTuiAct(async () => {
        testSetup.mockInput.pressKey("a", { ctrl: true });
      });
      await Bun.sleep(0);
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      expect(controller.getState().overlay.active?.kind).toBe("approval");
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Approvals");
      expect(frame).toContain("approval-1");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("stacks widget cards under the transcript on narrow terminals", async () => {
    const { bundle } = createFakeBundle({
      seedMessages: [
        {
          role: "assistant",
          content: "Hello from Brewva",
        },
      ],
    });
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 80,
        height: 24,
      },
    );

    try {
      await openTuiAct(async () => {
        controller.ui.setWidget("Queue", ["build pending"]);
        await Bun.sleep(CliShellController.STATUS_DEBOUNCE_MS + 20);
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Hello from Brewva");
      expect(frame).toContain("Queue");
      expect(frame).toContain("build pending");
      expect(findFrameLineIndex(frame, "build pending")).toBeGreaterThan(
        findFrameLineIndex(frame, "Hello from Brewva"),
      );
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("renders structured task overlays with a details panel in the OpenTUI shell", async () => {
    const { bundle } = createFakeBundle({
      sessionWireBySessionId: {
        "worker-session-1": [
          {
            schema: "brewva.session-wire.v2",
            sessionId: "worker-session-1",
            frameId: "frame-1",
            ts: Date.now(),
            source: "replay",
            durability: "durable",
            type: "turn.committed",
            turnId: "turn-1",
            attemptId: "attempt-1",
            status: "completed",
            assistantText: "QA summary line\nFound stale contract drift.",
            toolOutputs: [
              {
                toolCallId: "tool-1",
                toolName: "exec_command",
                verdict: "pass",
                isError: false,
                text: "bun test\n1775 pass",
              },
            ],
          },
        ],
      },
    });
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    controller.openOverlay({
      kind: "tasks",
      selectedIndex: 0,
      snapshot: {
        approvals: [],
        questions: [],
        taskRuns: [
          {
            runId: "run-1",
            delegate: "worker-1",
            parentSessionId: "session-1",
            status: "completed",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            label: "Review operator state",
            workerSessionId: "worker-session-1",
            summary: "Streaming output",
            resultData: {
              verdict: "pass",
            },
            artifactRefs: [
              {
                kind: "patch",
                path: ".orchestrator/subagent-runs/run-1/patch.diff",
                summary: "Suggested patch",
              },
            ],
            delivery: {
              mode: "supplemental",
              handoffState: "surfaced",
            },
            error: undefined,
          },
        ],
        sessions: [],
      },
    });

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "enter",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "pagedown",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Task run-1 output");
      expect(frame).toContain("worker-session-1");
      expect(frame).toContain("QA summary line");
      expect(frame).toContain("exec_command");
      expect(frame).toContain("inspect --session worker-session-1");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("renders structured inspect overlays with section navigation and details", async () => {
    const { bundle } = createFakeBundle();
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    const inspectPayload = Object.assign(
      {
        kind: "inspect" as const,
        lines: ["legacy inspect text"],
      },
      {
        sections: [
          {
            id: "summary",
            title: "Summary",
            lines: ["Session: session-1", "Workspace: /tmp/workspace"],
          },
          {
            id: "verification",
            title: "Verification",
            lines: ["Outcome: pass", "Missing checks: none"],
          },
        ],
        selectedIndex: 1,
        scrollOffsets: [0, 0],
      },
    );
    controller.openOverlay(inspectPayload);

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Inspect");
      expect(frame).toContain("Summary");
      expect(frame).toContain("Verification");
      expect(frame).toContain("Outcome");
      expect(frame).toContain("pass");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("scrolls pager overlays through semantic page-down input", async () => {
    const { bundle } = createFakeBundle();
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    const pagerPayload = Object.assign(
      {
        kind: "pager" as const,
        lines: Array.from({ length: 40 }, (_, index) => `line-${index + 1}`),
      },
      {
        title: "Task Details",
        scrollOffset: 0,
      },
    );
    controller.openOverlay(pagerPayload);

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();
      expect(frame).toContain("line-1");

      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "pagedown",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();

      frame = testSetup.captureCharFrame();
      expect(frame).toContain("line-20");
      expect(frame).not.toContain("line-4");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("drills from inspect sections into a pager and returns on escape", async () => {
    const { bundle } = createFakeBundle();
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    controller.openOverlay({
      kind: "inspect",
      lines: ["legacy inspect text"],
      sections: [
        {
          id: "summary",
          title: "Summary",
          lines: ["Session: session-1", "Workspace: /tmp/workspace"],
        },
        {
          id: "analysis",
          title: "Analysis",
          lines: ["Outcome: pass", "Missing checks: none"],
        },
      ],
      selectedIndex: 1,
      scrollOffsets: [0, 0],
    });

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();
      expect(frame).toContain("Inspect");
      expect(frame).toContain("Analysis");

      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "enter",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();

      frame = testSetup.captureCharFrame();
      expect(frame).toContain("Analysis");
      expect(frame).toContain("Missing");
      expect(frame).toContain("close/back");

      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "escape",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();

      frame = testSetup.captureCharFrame();
      expect(frame).toContain("Inspect");
      expect(frame).toContain("Analysis");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("renders the notification inbox and supports dismissing the selected item", async () => {
    const { bundle } = createFakeBundle();
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    controller.ui.notify("older notification", "info");
    controller.ui.notify("latest notification", "warning");

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "n",
          ctrl: true,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();

      let frame = testSetup.captureCharFrame();
      expect(frame).toContain("Notifications");
      expect(frame).toContain("latest notification");

      await openTuiAct(async () => {
        await controller.handleSemanticInput({
          key: "character",
          text: "d",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });
      await testSetup.renderOnce();
      await testSetup.renderOnce();

      frame = testSetup.captureCharFrame();
      expect(frame).toContain("Notifications");
      expect(frame).not.toContain("latest notification");
      expect(frame).toContain("older notification");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });

  test("renders session browser details for the current session even before replay events exist", async () => {
    const replaySessions = [
      {
        sessionId: "archived-session",
        eventCount: 14,
        lastEventAt: 1_710_000_000_000,
      },
    ] satisfies BrewvaReplaySession[];

    const { bundle } = createFakeBundle({
      sessionId: "fresh-session",
      replaySessions,
    });
    const controller = new CliShellController(bundle, {
      cwd: process.cwd(),
      openSession: async () => bundle,
      createSession: async () => bundle,
      operatorPollIntervalMs: 60_000,
    });

    await controller.start();
    controller.ui.setEditorText("draft line one");
    await openTuiAct(async () => {
      await controller.handleSemanticInput({
        key: "g",
        ctrl: true,
        meta: false,
        shift: false,
      });
    });

    const testSetup = await openTuiTestRender(
      createOpenTuiElement(BrewvaOpenTuiShell, { controller }),
      {
        width: 100,
        height: 28,
      },
    );

    try {
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Sessions");
      expect(frame).toContain("fresh-session");
      expect(frame).toContain("archived-session");
      expect(frame).toContain("none yet");
    } finally {
      controller.dispose();
      testSetup.renderer.destroy();
    }
  });
});
