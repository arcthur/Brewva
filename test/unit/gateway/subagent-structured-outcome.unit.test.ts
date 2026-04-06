import { describe, expect, test } from "bun:test";
import {
  STRUCTURED_OUTCOME_CLOSE,
  STRUCTURED_OUTCOME_OPEN,
} from "../../../packages/brewva-gateway/src/subagents/protocol.js";
import { extractStructuredOutcomeData } from "../../../packages/brewva-gateway/src/subagents/structured-outcome.js";

function buildAssistantText(payload: Record<string, unknown>): string {
  return [
    "Executed delegated QA.",
    STRUCTURED_OUTCOME_OPEN,
    JSON.stringify(payload, null, 2),
    STRUCTURED_OUTCOME_CLOSE,
  ].join("\n");
}

describe("subagent structured outcome normalization", () => {
  test("parses canonical design consult outcomes", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "consult",
      consultKind: "design",
      assistantText: buildAssistantText({
        kind: "consult",
        consultKind: "design",
        conclusion:
          "Unify read-only public delegation under advisor and keep workflow semantics parent-owned.",
        confidence: "high",
        evidence: [
          "The read-only public delegates share effectively identical execution envelopes.",
        ],
        counterevidence: ["The cutover touches routing, parsing, and overlay contracts at once."],
        risks: ["A partial migration could leave review lanes on a split contract family."],
        openQuestions: ["Whether any workspace overlays still rely on public review agent names."],
        recommendedNextSteps: ["Cut the public taxonomy in one pass and rebase internal lanes."],
        options: [
          {
            option: "Keep separate read-only public agent specs.",
            summary: "Preserves familiar names but leaves execution identity fragmented.",
            tradeoffs: ["Semantic overlap and prompt drift remain."],
          },
          {
            option: "Unify read-only public delegation under advisor.",
            summary:
              "Keeps execution identity singular while leaving semantic workflow lanes in parent skills.",
            tradeoffs: ["Requires a broader contract and parser cutover."],
          },
        ],
        recommendedOption: "Unify read-only public delegation under advisor.",
        boundaryImplications: [
          "Delegation transport changes, but workflow.design and workflow.review remain parent-owned.",
        ],
        verificationPlan: [
          "Contract-test consult payload parsing.",
          "Verify parent design skill still emits canonical planning artifacts.",
        ],
      }),
    });

    expect(outcome.data).toMatchObject({
      kind: "consult",
      consultKind: "design",
      recommendedOption: "Unify read-only public delegation under advisor.",
    });
    expect(outcome.skillOutputs).toBeUndefined();
  });

  test("rejects design consult outcomes when required fields drift from the canonical contract", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "consult",
      consultKind: "design",
      assistantText: buildAssistantText({
        kind: "consult",
        consultKind: "design",
        conclusion: "Keep the design taxonomy aligned with the advisor contract.",
        confidence: "medium",
        evidence: ["Parser acceptance depends on the canonical design consult fields."],
        counterevidence: ["Some historical outcomes used plan-specific field names."],
        risks: ["Drifted contracts can silently bypass downstream consumers."],
        openQuestions: ["Which workspace overlays still emit legacy plan payloads?"],
        recommendedNextSteps: ["Reject non-canonical design consult payloads during parsing."],
        options: [
          {
            option: "Emit a structured design consult payload.",
            summary: "Exercise canonical consult parsing.",
            tradeoffs: ["Any field drift should fail fast."],
          },
        ],
        recommendedOption: "Emit a structured design consult payload.",
        boundaryImplications: ["Delegation parsing now keys off consultKind instead of plan mode."],
      }),
    });

    expect(outcome.data).toBeUndefined();
    expect(outcome.parseError).toBe("invalid_structured_outcome_payload");
  });

  test("rejects QA structured outcomes when the only command check omits exit_code", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "qa",
      skillName: "qa",
      assistantText: buildAssistantText({
        kind: "qa",
        skillName: "qa",
        checks: [
          {
            name: "boundary-check",
            status: "pass",
            command: "bun test -- boundary-check",
            observed_output: "boundary-check passed",
            probe_type: "boundary",
          },
        ],
      }),
    });

    expect(outcome.data).toBeUndefined();
    expect(outcome.parseError).toBe("invalid_structured_outcome_payload");
  });

  test("preserves evidence-backed QA pass verdicts and mirrors canonical fields", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "qa",
      skillName: "qa",
      assistantText: buildAssistantText({
        kind: "qa",
        skillName: "qa",
        checks: [
          {
            name: "boundary-check",
            status: "pass",
            command: "bun test -- boundary-check",
            tool: "exec",
            cwd: ".",
            exit_code: 0,
            observed_output: "boundary-check passed",
            probe_type: "boundary",
            evidence_refs: ["artifacts/boundary-check.txt"],
          },
        ],
        verdict: "pass",
      }),
    });

    expect(outcome.data).toMatchObject({
      kind: "qa",
      verdict: "pass",
    });
    expect(outcome.skillOutputs).toMatchObject({
      qa_verdict: "pass",
      qa_checks: [
        expect.objectContaining({
          command: "bun test -- boundary-check",
          exit_code: 0,
          status: "pass",
          summary: "boundary-check",
          probe_type: "boundary",
          observed_output: "boundary-check passed",
        }),
      ],
    });
  });

  test("rejects QA structured outcomes when the only check omits execution descriptors", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "qa",
      skillName: "qa",
      assistantText: buildAssistantText({
        kind: "qa",
        skillName: "qa",
        verdict: "pass",
        checks: [
          {
            name: "boundary-check",
            status: "pass",
            observed_output: "Boundary harness looked healthy.",
            probe_type: "boundary",
          },
        ],
      }),
    });

    expect(outcome.data).toBeUndefined();
    expect(outcome.parseError).toBe("invalid_structured_outcome_payload");
  });

  test("rejects QA structured outcomes when the only check omits observed_output", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "qa",
      skillName: "qa",
      assistantText: buildAssistantText({
        kind: "qa",
        skillName: "qa",
        verdict: "pass",
        checks: [
          {
            name: "boundary-check",
            status: "pass",
            command: "bun test -- boundary-check",
            exit_code: 0,
            probe_type: "boundary",
          },
        ],
      }),
    });

    expect(outcome.data).toBeUndefined();
    expect(outcome.parseError).toBe("invalid_structured_outcome_payload");
  });

  test("downgrades QA verdicts when malformed checks are discarded by the canonical contract", () => {
    const outcome = extractStructuredOutcomeData({
      resultMode: "qa",
      skillName: "qa",
      assistantText: buildAssistantText({
        kind: "qa",
        skillName: "qa",
        verdict: "pass",
        checks: [
          {
            name: "boundary-check",
            status: "pass",
            command: "bun test -- boundary-check",
            exit_code: 0,
            observed_output: "boundary-check passed",
            probe_type: "boundary",
          },
          {
            name: "discarded-check",
            status: "pass",
            command: "bun test -- discarded-check",
            probe_type: "boundary",
          },
        ],
      }),
    });

    expect(outcome.data).toMatchObject({
      kind: "qa",
      verdict: "inconclusive",
    });
    expect(outcome.skillOutputs).toMatchObject({
      qa_verdict: "inconclusive",
      qa_confidence_gaps: expect.arrayContaining([
        expect.stringContaining("discarded because the canonical execution evidence contract"),
      ]),
    });
  });
});
