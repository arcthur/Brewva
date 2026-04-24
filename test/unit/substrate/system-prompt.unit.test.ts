import { describe, expect, test } from "bun:test";
import { buildBrewvaSystemPrompt } from "@brewva/brewva-substrate";

describe("Brewva system prompt", () => {
  test("adds question guidance when the question tool is visible", () => {
    const prompt = buildBrewvaSystemPrompt({
      selectedTools: ["read", "question"],
      toolSnippets: {
        read: "Read files from the workspace.",
        question: "Ask the user one or more structured questions and wait for their answers.",
      },
      cwd: "/workspace",
    });

    expect(prompt).toContain("question: Ask the user one or more structured questions");
    expect(prompt).toContain(
      "When progress depends on a blocking user choice or missing requirement, use the question tool",
    );
  });
});
