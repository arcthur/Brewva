import { describe, expect, test } from "bun:test";
import { getModel, getModels } from "@brewva/brewva-provider-core";

describe("provider core model catalog", () => {
  test("does not expose retired Gemini generateContent models", () => {
    const retiredModelIds = [
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
      "gemini-2.5-flash-lite-preview-06-17",
      "gemini-2.5-flash-lite-preview-09-2025",
      "gemini-2.5-flash-preview-04-17",
      "gemini-2.5-flash-preview-05-20",
      "gemini-2.5-flash-preview-09-2025",
      "gemini-2.5-pro-preview-05-06",
      "gemini-2.5-pro-preview-06-05",
      "gemini-live-2.5-flash",
      "gemini-live-2.5-flash-preview-native-audio",
      "gemma-4-26b-it",
    ];

    const googleModelIds = getModels("google").map((model) => model.id);

    for (const modelId of retiredModelIds) {
      expect(googleModelIds).not.toContain(modelId);
    }
    expect(googleModelIds).toContain("gemini-2.5-flash");
    expect(googleModelIds).toContain("gemini-2.5-pro");
  });

  test("rejects direct lookup of retired Gemini models", () => {
    expect(() => getModel("google", "gemini-2.5-flash-preview-04-17")).toThrow(
      'Model "google/gemini-2.5-flash-preview-04-17" is retired.',
    );
  });

  test("exposes documented Kimi Code and Moonshot platform model routes", () => {
    const kimiCodeModels = getModels("kimi-coding").map((model) => model.id);
    expect(kimiCodeModels).toEqual(["kimi-for-coding"]);

    const moonshotCnModels = getModels("moonshot-cn").map((model) => model.id);
    const moonshotAiModels = getModels("moonshot-ai").map((model) => model.id);
    expect(moonshotCnModels).toEqual(["kimi-k2.6", "kimi-k2.5"]);
    expect(moonshotAiModels).toEqual(moonshotCnModels);
  });

  test("exposes the current official OpenAI GPT family defaults", () => {
    const openaiModels = getModels("openai");
    const openaiModelIds = openaiModels.map((model) => model.id);

    expect(openaiModelIds).toContain("gpt-5.5");
    expect(openaiModelIds).toContain("gpt-5.5-pro");
    expect(openaiModelIds).toContain("gpt-5.4");
    expect(openaiModelIds).toContain("gpt-5.4-mini");
    expect(openaiModelIds).toContain("gpt-5.4-nano");

    const flagship = getModel("openai", "gpt-5.5");
    expect(flagship).toMatchObject({
      api: "openai-responses",
      provider: "openai",
      reasoning: true,
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      cost: {
        input: 5,
        output: 30,
        cacheRead: 0.5,
        cacheWrite: 0,
      },
    });
  });
});
