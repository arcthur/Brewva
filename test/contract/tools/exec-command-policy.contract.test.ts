import { describe, expect, test } from "bun:test";
import { createExecTool } from "@brewva/brewva-tools";
import { assertRejectsWithMessage } from "../../helpers.js";
import { requireDefined, requireRecord } from "../../helpers/assertions.js";
import {
  createRuntimeForExecTests,
  extractTextContent,
  fakeContext,
} from "./tools-exec-process.helpers.js";

type CommandPolicyPayload = {
  readonlyEligible?: boolean;
  commands?: string[];
  unsupportedReasons?: Array<{ code?: string }>;
};

type VirtualReadonlyPayload = {
  eligible?: boolean;
  materializedCandidates?: string[];
  blockedReasons?: Array<{ code?: string; command?: string }>;
};

function eventTypes(events: Array<{ type?: string }>): string[] {
  return events.flatMap((event) => (typeof event.type === "string" ? [event.type] : []));
}

describe("exec command policy routing", () => {
  test("readonly command routes to virtual backend and records exploration evidence", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "sandbox",
      fallbackToHost: false,
      serverUrl: "http://127.0.0.1:2",
    });
    const execTool = createExecTool({ runtime });

    const result = await execTool.execute(
      "tc-exec-readonly-virtual",
      {
        command: "cat package.json | head -n 1",
      },
      undefined,
      undefined,
      fakeContext("s13-exec-readonly-virtual"),
    );

    expect(extractTextContent(result)).toContain("{");
    expect(result.details).toMatchObject({
      backend: "virtual_readonly",
      evidenceKind: "exploration",
      verificationEvidence: false,
      isolation: "materialized_workspace_subset",
    });
    const details = requireRecord(result.details, "Expected exec details.");
    expect(details.materializedPaths).toEqual(["package.json"]);

    const routed = requireDefined(
      events.find((event) => event.type === "exec_routed"),
      "Expected exec_routed event.",
    );
    expect(routed.payload?.resolvedBackend).toBe("virtual_readonly");
    const commandPolicy = requireRecord(
      routed.payload?.commandPolicy,
      "Expected commandPolicy payload.",
    ) as CommandPolicyPayload;
    expect(commandPolicy.readonlyEligible).toBe(true);
    expect(commandPolicy.commands).toEqual(["cat", "head"]);
    const virtualReadonly = requireRecord(
      routed.payload?.virtualReadonly,
      "Expected virtualReadonly payload.",
    ) as VirtualReadonlyPayload;
    expect(virtualReadonly.eligible).toBe(true);
    expect(virtualReadonly.materializedCandidates).toEqual(["package.json"]);
  });

  test("readonly virtual route withholds bound credential environment", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "sandbox",
      fallbackToHost: false,
      serverUrl: "http://127.0.0.1:2",
      boundEnv: { BREWVA_TEST_SECRET: "super-secret-value" },
    });
    const execTool = createExecTool({ runtime });

    const result = await execTool.execute(
      "tc-exec-readonly-bound-env",
      {
        command: "cat package.json | head -n 1",
      },
      undefined,
      undefined,
      fakeContext("s13-exec-readonly-bound-env"),
    );

    expect(result.details).toMatchObject({
      backend: "virtual_readonly",
      evidenceKind: "exploration",
      verificationEvidence: false,
    });
    const routed = requireDefined(
      events.find((event) => event.type === "exec_routed"),
      "Expected exec_routed event.",
    );
    expect(routed.payload?.resolvedBackend).toBe("virtual_readonly");
    expect(routed.payload?.requestedEnvKeys).toEqual([]);
    expect(routed.payload?.withheldBoundEnvKeys).toEqual(["BREWVA_TEST_SECRET"]);
    expect(JSON.stringify(routed.payload)).not.toContain("super-secret-value");
  });

  test("grep commands with option-supplied patterns still materialize file candidates", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "sandbox",
      fallbackToHost: false,
      serverUrl: "http://127.0.0.1:2",
    });
    const execTool = createExecTool({ runtime });

    const result = await execTool.execute(
      "tc-exec-grep-option-pattern",
      {
        command: "grep -e name package.json",
      },
      undefined,
      undefined,
      fakeContext("s13-exec-grep-option-pattern"),
    );

    expect(extractTextContent(result)).toContain("name");
    expect(result.details).toMatchObject({
      backend: "virtual_readonly",
      materializedPaths: ["package.json"],
    });

    const routed = requireDefined(
      events.find((event) => event.type === "exec_routed"),
      "Expected exec_routed event.",
    );
    expect(routed.payload?.resolvedBackend).toBe("virtual_readonly");
    const virtualReadonly = requireRecord(
      routed.payload?.virtualReadonly,
      "Expected virtualReadonly payload.",
    ) as VirtualReadonlyPayload;
    expect(virtualReadonly).toMatchObject({
      eligible: true,
      materializedCandidates: ["package.json"],
      blockedReasons: [],
    });
  });

  test("unsupported shell constructs fail closed without host fallback", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "sandbox",
      fallbackToHost: false,
      serverUrl: "http://127.0.0.1:2",
    });
    const execTool = createExecTool({ runtime });

    await assertRejectsWithMessage(
      () =>
        execTool.execute(
          "tc-exec-unsupported-no-fallback",
          {
            command: "cat $(pwd)/package.json",
          },
          undefined,
          undefined,
          fakeContext("s13-exec-unsupported-no-fallback"),
        ),
      "exec_blocked_isolation",
    );

    expect(eventTypes(events)).toContain("exec_blocked_isolation");
    expect(eventTypes(events)).not.toContain("exec_fallback_host");
    const blocked = requireDefined(
      events.find((event) => event.type === "exec_blocked_isolation"),
      "Expected exec_blocked_isolation event.",
    );
    const commandPolicy = requireRecord(
      blocked.payload?.commandPolicy,
      "Expected commandPolicy payload.",
    ) as CommandPolicyPayload;
    expect(commandPolicy.readonlyEligible).toBe(false);
    expect(commandPolicy.unsupportedReasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "command_substitution" })]),
    );
  });

  test("unsafe absolute path is not authorized as a virtual readonly route", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "sandbox",
      fallbackToHost: false,
      serverUrl: "http://127.0.0.1:2",
    });
    const execTool = createExecTool({ runtime });

    await assertRejectsWithMessage(
      () =>
        execTool.execute(
          "tc-exec-readonly-absolute-path",
          {
            command: "cat /etc/hosts",
          },
          undefined,
          undefined,
          fakeContext("s13-exec-readonly-absolute-path"),
        ),
      "exec_blocked_isolation",
    );

    expect(eventTypes(events)).toContain("exec_blocked_isolation");
    expect(eventTypes(events)).not.toContain("exec_fallback_host");
    const routed = requireDefined(
      events.find((event) => event.type === "exec_routed"),
      "Expected exec_routed event.",
    );
    expect(routed.payload?.resolvedBackend).toBe("sandbox");
    const blocked = requireDefined(
      events.find((event) => event.type === "exec_blocked_isolation"),
      "Expected exec_blocked_isolation event.",
    );
    expect(blocked.payload?.reason).toBe("sandbox_execution_error");
    const virtualReadonly = requireRecord(
      blocked.payload?.virtualReadonly,
      "Expected virtualReadonly payload.",
    ) as VirtualReadonlyPayload;
    expect(virtualReadonly).toMatchObject({
      eligible: false,
      blockedReasons: [
        {
          code: "unsafe_virtual_readonly_path",
          command: "cat",
        },
      ],
    });
  });

  test("exec drops prototype-polluting environment keys before host execution", async () => {
    const { runtime, events } = createRuntimeForExecTests({
      mode: "standard",
      backend: "host",
      fallbackToHost: false,
    });
    const execTool = createExecTool({ runtime });
    const env = Object.create(null) as Record<string, string>;
    env.SAFE_ENV = "ok";
    Object.defineProperty(env, "__proto__", { enumerable: true, value: "polluted" });
    env["constructor"] = "polluted";

    const result = await execTool.execute(
      "tc-exec-env-prototype-keys",
      {
        command:
          "node -e \"console.log(process.env.SAFE_ENV); console.log(Object.hasOwn(process.env, '__proto__') ? 'polluted' : 'clean')\"",
        env,
      },
      undefined,
      undefined,
      fakeContext("s13-exec-env-prototype-keys"),
    );

    expect(extractTextContent(result)).toContain("ok\nclean");
    const routed = requireDefined(
      events.find((event) => event.type === "exec_routed"),
      "Expected exec_routed event.",
    );
    expect(routed.payload?.appliedEnvKeys).toEqual(["SAFE_ENV"]);
    expect(routed.payload?.droppedEnvKeys).toEqual(
      expect.arrayContaining(["__proto__", "constructor"]),
    );
  });
});
