import { describe, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { CONTEXT_SOURCES, BrewvaRuntime, SKILL_COMPLETED_EVENT_TYPE } from "@brewva/brewva-runtime";
import { recordRuntimeEvent } from "@brewva/brewva-runtime/internal";
import { createSkillPromotionContextProvider } from "@brewva/brewva-skill-broker";
import { createSkillPromotionTool } from "@brewva/brewva-tools";
import { createTestWorkspace } from "../../helpers/workspace.js";

function createWorkspaceWithSkills(name: string): string {
  const workspace = createTestWorkspace(name);
  const repoRoot = resolve(import.meta.dirname, "../../..");
  cpSync(resolve(repoRoot, "skills"), resolve(workspace, "skills"), { recursive: true });
  return workspace;
}

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  return (
    result.content.find((item) => item.type === "text" && typeof item.text === "string")?.text ?? ""
  );
}

function recordPromotionSourceEvent(
  runtime: BrewvaRuntime,
  sessionId: string,
  timestamp: number,
): void {
  recordRuntimeEvent(runtime, {
    sessionId,
    type: SKILL_COMPLETED_EVENT_TYPE,
    timestamp,
    payload: {
      skillName: "self-improve",
      outputs: {
        improvement_hypothesis:
          "The self-improve skill should route repeated delivery failures into explicit promotion drafts.",
        improvement_plan:
          "Patch self-improve so repeated failures produce reviewable promotion drafts.",
        learning_backlog: [
          "Collect repeated failure clusters before updating the skill catalog.",
          "Materialize promotion packets instead of patching live skills directly.",
        ],
      },
    },
  });
}

describe("skill promotion tool", () => {
  test("lists, reviews, and promotes evidence-backed drafts", async () => {
    const workspace = createWorkspaceWithSkills("skill-promotion-tool");
    const runtime = new BrewvaRuntime({ cwd: workspace });
    recordPromotionSourceEvent(runtime, "promotion-tool-session-1", 1_000);
    recordPromotionSourceEvent(runtime, "promotion-tool-session-2", 2_000);

    const tool = createSkillPromotionTool({ runtime });

    const listResult = await tool.execute(
      "tc-skill-promotion-list",
      { action: "list" } as never,
      undefined,
      undefined,
      {} as never,
    );
    const listText = extractText(listResult as { content: Array<{ type: string; text?: string }> });
    const listDetails = listResult.details as { drafts?: Array<{ id: string }> } | undefined;
    expect(listText).toContain("# Skill Promotion Drafts");
    expect(listDetails?.drafts).toHaveLength(1);

    const draftId = listDetails?.drafts?.[0]?.id;
    expect(typeof draftId).toBe("string");

    const reviewResult = await tool.execute(
      "tc-skill-promotion-review",
      {
        action: "review",
        draft_id: draftId!,
        decision: "approve",
        note: "Evidence is repeated and the target home is correct.",
      } as never,
      undefined,
      undefined,
      {} as never,
    );
    const reviewText = extractText(
      reviewResult as { content: Array<{ type: string; text?: string }> },
    );
    expect(reviewText).toContain("status: approved");
    expect(reviewText).toContain("decision: approve");

    const promoteResult = await tool.execute(
      "tc-skill-promotion-promote",
      {
        action: "promote",
        draft_id: draftId!,
        target_kind: "new_skill",
      } as never,
      undefined,
      undefined,
      {} as never,
    );
    const promoteText = extractText(
      promoteResult as { content: Array<{ type: string; text?: string }> },
    );
    const promoteDetails = promoteResult.details as
      | {
          promotion?: { primaryPath?: string; format?: string };
        }
      | undefined;
    expect(promoteText).toContain("status: promoted");
    expect(promoteDetails?.promotion?.format).toBe("skill_scaffold");
    expect(promoteDetails?.promotion?.primaryPath?.endsWith("SKILL.md")).toBe(true);
  });

  test("shares promotion authority with the context provider without hidden provider writes", async () => {
    const workspace = createWorkspaceWithSkills("skill-promotion-tool-provider");
    const runtime = new BrewvaRuntime({ cwd: workspace });
    recordPromotionSourceEvent(runtime, "promotion-tool-provider-1", 1_000);
    recordPromotionSourceEvent(runtime, "promotion-tool-provider-2", 2_000);

    const provider = createSkillPromotionContextProvider({
      runtime,
      maxDrafts: 2,
      minRefreshIntervalMs: 1,
    });
    const beforeSyncEntries: Array<{ id: string; content: string }> = [];
    provider.collect({
      sessionId: "promotion-tool-provider-2",
      promptText: "promote the repeated lesson into a reusable skill",
      register: (entry) => {
        beforeSyncEntries.push(entry);
      },
    });

    expect(provider.source).toBe(CONTEXT_SOURCES.skillPromotionDrafts);
    expect(beforeSyncEntries).toHaveLength(0);

    const tool = createSkillPromotionTool({ runtime });
    const listResult = await tool.execute(
      "tc-skill-promotion-provider-list",
      { action: "list" } as never,
      undefined,
      undefined,
      {} as never,
    );
    const listDetails = listResult.details as { drafts?: Array<{ id: string }> } | undefined;
    const draftId = listDetails?.drafts?.[0]?.id;
    expect(typeof draftId).toBe("string");

    const afterListEntries: Array<{ id: string; content: string }> = [];
    provider.collect({
      sessionId: "promotion-tool-provider-2",
      promptText: "promote the repeated lesson into a reusable skill",
      register: (entry) => {
        afterListEntries.push(entry);
      },
    });
    expect(afterListEntries).toHaveLength(1);
    expect(afterListEntries[0]?.id).toBe(draftId);

    await tool.execute(
      "tc-skill-promotion-provider-promote",
      {
        action: "promote",
        draft_id: draftId!,
        target_kind: "new_skill",
      } as never,
      undefined,
      undefined,
      {} as never,
    );

    const afterPromoteEntries: Array<{ id: string; content: string }> = [];
    provider.collect({
      sessionId: "promotion-tool-provider-2",
      promptText: "promote the repeated lesson into a reusable skill",
      register: (entry) => {
        afterPromoteEntries.push(entry);
      },
    });
    expect(afterPromoteEntries).toHaveLength(0);
  });
});
