import { describe, expect, test } from "bun:test";
import { resolveSkillDispatchDecision, type SkillsIndexEntry } from "@brewva/brewva-runtime";

function createEntry(
  input: Partial<SkillsIndexEntry> & Pick<SkillsIndexEntry, "name">,
): SkillsIndexEntry {
  return {
    name: input.name,
    tier: input.tier ?? "base",
    description: input.description ?? `${input.name} skill`,
    outputs: input.outputs ?? [],
    toolsRequired: input.toolsRequired ?? [],
    costHint: input.costHint ?? "medium",
    stability: input.stability ?? "stable",
    composableWith: input.composableWith ?? [],
    consumes: input.consumes ?? [],
    requires: input.requires ?? [],
    effectLevel: input.effectLevel ?? "read_only",
    dispatch: input.dispatch,
  };
}

describe("skill dispatch decision", () => {
  test("falls back to default dispatch thresholds when dispatch metadata is absent", () => {
    const decision = resolveSkillDispatchDecision({
      selected: [{ name: "review", score: 12, reason: "semantic:review", breakdown: [] }],
      index: [createEntry({ name: "review" })],
      turn: 5,
    });

    expect(decision.mode).toBe("gate");
    expect(decision.reason).toContain("gate_threshold(10)");
  });

  test("normalizes malformed dispatch metadata from external index entries", () => {
    const decision = resolveSkillDispatchDecision({
      selected: [{ name: "review", score: 0, reason: "none", breakdown: [] }],
      index: [
        createEntry({
          name: "review",
          dispatch: {
            gateThreshold: Number.NaN,
            autoThreshold: Number.NaN,
            defaultMode: "invalid-mode" as unknown as "suggest",
          },
        }),
      ],
      turn: 6,
    });

    expect(decision.mode).toBe("suggest");
    expect(decision.reason).toContain("gate_threshold(10)");
  });

  test("read_only dispatch does not expand into mutation prerequisites", () => {
    const decision = resolveSkillDispatchDecision({
      selected: [{ name: "review", score: 22, reason: "semantic:review", breakdown: [] }],
      index: [
        createEntry({
          name: "review",
          requires: ["change_summary"],
          effectLevel: "read_only",
        }),
        createEntry({
          name: "patching",
          outputs: ["change_summary"],
          effectLevel: "mutation",
        }),
      ],
      turn: 7,
    });

    expect(decision.chain).toEqual(["review"]);
    expect(decision.unresolvedConsumes).toEqual(["change_summary"]);
  });

  test("collapses to the primary skill when a planned chain would still be invalid", () => {
    const decision = resolveSkillDispatchDecision({
      selected: [{ name: "patching", score: 22, reason: "semantic:patching", breakdown: [] }],
      index: [
        createEntry({
          name: "patching",
          requires: ["change_summary"],
          effectLevel: "mutation",
        }),
        createEntry({
          name: "planning",
          requires: ["architecture_map"],
          outputs: ["change_summary"],
          effectLevel: "read_only",
        }),
      ],
      turn: 8,
    });

    expect(decision.chain).toEqual(["patching"]);
    expect(decision.unresolvedConsumes).toEqual(
      expect.arrayContaining(["architecture_map", "change_summary"]),
    );
  });
});
