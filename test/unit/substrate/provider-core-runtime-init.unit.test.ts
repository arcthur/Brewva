import { describe, expect, test } from "bun:test";
import { clearApiProviders, getApiProviders, type ApiProvider } from "@brewva/brewva-provider-core";
import { registerBuiltInApiProviders } from "../../../packages/brewva-provider-core/src/providers/register-builtins.js";

describe("provider core runtime initialization", () => {
  test("registerBuiltInApiProviders restores the canonical built-in API registry", () => {
    clearApiProviders();
    expect(getApiProviders()).toEqual([]);

    registerBuiltInApiProviders();

    const apis = getApiProviders()
      .map((provider: ApiProvider) => provider.api)
      .toSorted();

    expect(apis).toEqual([
      "anthropic-messages",
      "google-gemini-cli",
      "google-generative-ai",
      "openai-codex-responses",
      "openai-completions",
      "openai-responses",
    ]);
  });
});
