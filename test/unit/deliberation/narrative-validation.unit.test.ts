import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateNarrativeMemoryCandidate } from "@brewva/brewva-deliberation";
import { createTestWorkspace } from "../../helpers/workspace.js";

describe("narrative memory validation", () => {
  test("detects Chinese policy contradictions against operator-authored agent memory", () => {
    const workspace = createTestWorkspace("narrative-validation-cjk-contradiction");
    const memoryPath = resolve(workspace, ".brewva", "agents", "default", "memory.md");
    mkdirSync(dirname(memoryPath), { recursive: true });
    writeFileSync(
      memoryPath,
      ["# Memory", "", "## Operator Preferences", "- 不要使用 npm 命令管理依赖。", ""].join("\n"),
      "utf8",
    );

    const result = validateNarrativeMemoryCandidate({
      workspaceRoot: workspace,
      agentId: "default",
      candidate: {
        class: "operator_preference",
        title: "Use npm",
        content: "应该使用 npm 命令安装依赖。",
        applicabilityScope: "repository",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "agent_memory_contradiction",
    });
  });
});
