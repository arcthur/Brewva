import { describe, expect, test } from "bun:test";
import {
  BrewvaRuntime,
  selectTopKSkills,
  type SkillTriggerPolicy,
  type SkillsIndexEntry,
} from "@brewva/brewva-runtime";

function repoRoot(): string {
  return process.cwd();
}

function createIndexEntry(
  input: Partial<SkillsIndexEntry> & Pick<SkillsIndexEntry, "name">,
): SkillsIndexEntry {
  return {
    name: input.name,
    tier: input.tier ?? "base",
    description: input.description ?? `${input.name} skill`,
    tags: input.tags ?? [],
    antiTags: input.antiTags ?? [],
    outputs: input.outputs ?? [],
    toolsRequired: input.toolsRequired ?? [],
    costHint: input.costHint ?? "medium",
    stability: input.stability ?? "stable",
    composableWith: input.composableWith ?? [],
    consumes: input.consumes ?? [],
    triggers: input.triggers,
    dispatch: input.dispatch,
  };
}

function emptyTriggers(): SkillTriggerPolicy {
  return {
    intents: [],
    topics: [],
    phrases: [],
    negatives: [],
  };
}

describe("S-001 selector inject top-k and anti-tags", () => {
  test("given query with anti-tag context, when selecting skills, then blocked skill is excluded", async () => {
    const runtime = new BrewvaRuntime({ cwd: repoRoot() });
    const selected = runtime.skills.select("debug failing test regression in typescript module");
    expect(selected.length).toBeGreaterThan(0);

    const docsSelected = runtime.skills.select("implement a new feature and update docs");
    expect(docsSelected.some((skill) => skill.name === "debugging")).toBe(false);
  });

  test("does not hard-exclude review on incidental implementation mention", () => {
    const runtime = new BrewvaRuntime({ cwd: repoRoot() });
    const selected = runtime.skills.select(
      "Review the project in depth. Do you think current implementation has followed the philosophy of the project",
    );
    expect(selected.some((skill) => skill.name === "review")).toBe(true);
  });

  test("does not match short tags by substring", () => {
    const runtime = new BrewvaRuntime({ cwd: repoRoot() });
    const selected = runtime.skills.select(
      "Analyze project architecture and produce risk-ranked findings",
    );
    expect(selected.some((skill) => skill.name === "gh-issues")).toBe(false);
    expect(selected.some((skill) => skill.name === "github")).toBe(false);
  });

  test("supports chinese review intent routing", () => {
    const runtime = new BrewvaRuntime({ cwd: repoRoot() });
    const selected = runtime.skills.select("请深度审查项目实现是否符合项目哲学");
    expect(selected.some((skill) => skill.name === "review")).toBe(true);
  });

  test("does not leak intent tail token into body window after trimming imperative prefix", () => {
    const selected = selectTopKSkills(
      "Please review code. run tests",
      [
        createIndexEntry({
          name: "cross-boundary",
          description: "cross boundary matcher",
          tags: [],
          triggers: {
            ...emptyTriggers(),
            intents: ["code run"],
          },
        }),
      ],
      3,
      {
        semanticFallback: {
          enabled: false,
        },
      },
    );
    expect(selected).toEqual([]);
  });

  test("falls back to legacy matching when triggers are omitted", () => {
    const selected = selectTopKSkills(
      "Review architecture quality risks",
      [
        createIndexEntry({
          name: "review-lite",
          tags: ["review", "quality"],
          description: "architecture review helper",
        }),
      ],
      1,
    );
    expect(selected[0]?.name).toBe("review-lite");
  });

  test("uses semantic fallback when lexical score is below bypass threshold", () => {
    const selected = selectTopKSkills(
      "Is this ready to ship?",
      [
        createIndexEntry({
          name: "review",
          description: "Pre-merge risk checks and merge safety assessment for release decisions",
          tags: ["quality", "risk", "merge-safety"],
          triggers: emptyTriggers(),
        }),
        createIndexEntry({
          name: "patching",
          description: "Apply code edits and implement requested fixes",
          tags: ["implementation"],
          triggers: emptyTriggers(),
        }),
      ],
      2,
      {
        semanticFallback: {
          enabled: true,
          lexicalBypassScore: 8,
          minSimilarity: 0.2,
          embeddingDimensions: 384,
        },
      },
    );

    expect(selected[0]?.name).toBe("review");
    expect(selected[0]?.reason.startsWith("semantic:")).toBe(true);
  });

  test("skips semantic fallback when lexical top score already passes bypass threshold", () => {
    const selected = selectTopKSkills(
      "Review this diff thoroughly.",
      [
        createIndexEntry({
          name: "review",
          description: "Pre-merge risk checks and quality audits",
          tags: ["review", "risk"],
          triggers: {
            ...emptyTriggers(),
            intents: ["review"],
          },
        }),
        createIndexEntry({
          name: "ship-readiness",
          description: "Release readiness checklist for production shipping",
          tags: [],
          triggers: emptyTriggers(),
        }),
      ],
      3,
      {
        semanticFallback: {
          enabled: true,
          lexicalBypassScore: 8,
          minSimilarity: 0,
          embeddingDimensions: 384,
        },
      },
    );

    expect(selected.some((entry) => entry.name === "ship-readiness")).toBe(false);
  });

  test("respects negative intent rules for semantic fallback candidates", () => {
    const selected = selectTopKSkills(
      "Please implement this. Is this ready to ship?",
      [
        createIndexEntry({
          name: "review",
          description: "Pre-merge risk checks and merge safety assessment for release decisions",
          tags: ["quality", "risk"],
          triggers: {
            ...emptyTriggers(),
            negatives: [{ scope: "intent", terms: ["implement"] }],
          },
        }),
      ],
      1,
      {
        semanticFallback: {
          enabled: true,
          lexicalBypassScore: 8,
          minSimilarity: 0.2,
          embeddingDimensions: 384,
        },
      },
    );

    expect(selected).toEqual([]);
  });
});
