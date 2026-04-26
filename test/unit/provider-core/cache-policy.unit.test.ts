import { describe, expect, test } from "bun:test";
import {
  buildProviderCacheBucketKey,
  normalizeProviderCachePolicy,
  resolveAnthropicCacheRender,
  resolveBedrockCacheRender,
  resolveProviderCacheCapability,
  resolveOpenAIResponsesCacheRender,
} from "../../../packages/brewva-provider-core/src/cache-policy.js";

describe("provider cache policy", () => {
  test("normalizes missing policy to the session-scoped short default", () => {
    expect(normalizeProviderCachePolicy(undefined)).toEqual({
      retention: "short",
      writeMode: "readWrite",
      scope: "session",
      reason: "default",
    });
  });

  test("builds stable cache buckets from provider, model, session, and policy", () => {
    const bucketKey = buildProviderCacheBucketKey({
      provider: "openai",
      model: "gpt-5.4",
      api: "openai-responses",
      sessionId: "session-1",
      policy: {
        retention: "long",
        writeMode: "readWrite",
        scope: "session",
        reason: "config",
      },
    });

    expect(bucketKey).toBe(
      "provider=openai|api=openai-responses|model=gpt-5.4|scope=session|retention=long|writeMode=readWrite|session=session-1",
    );
  });

  test("keeps provider cache buckets independent from transport negotiation", () => {
    const input = {
      provider: "openai",
      model: "gpt-5.4",
      api: "openai-responses" as const,
      sessionId: "session-transport",
      policy: {
        retention: "short" as const,
        writeMode: "readWrite" as const,
        scope: "session" as const,
        reason: "default" as const,
      },
    };

    const withAuto = buildProviderCacheBucketKey({
      ...input,
      transport: "auto",
    } as Parameters<typeof buildProviderCacheBucketKey>[0]);
    const withSse = buildProviderCacheBucketKey({
      ...input,
      transport: "sse",
    } as Parameters<typeof buildProviderCacheBucketKey>[0]);

    expect(withAuto).toBe(withSse);
  });

  test("renders OpenAI Responses long retention only for direct OpenAI requests", () => {
    expect(
      resolveOpenAIResponsesCacheRender({
        baseUrl: "https://api.openai.com/v1",
        provider: "openai",
        modelId: "gpt-5.4",
        sessionId: "session-openai",
        policy: {
          retention: "long",
          writeMode: "readWrite",
          scope: "session",
          reason: "config",
        },
      }),
    ).toEqual({
      status: "rendered",
      reason: "rendered_openai_prompt_cache",
      renderedRetention: "long",
      bucketKey: "openai-responses|session=session-openai|retention=long|writeMode=readWrite",
      promptCacheKey: "session-openai",
      promptCacheRetention: "24h",
      capability: expect.objectContaining({
        strategies: ["promptCacheKey"],
        cacheCounters: "readOnly",
        longRetention: "24h",
      }),
    });

    expect(
      resolveOpenAIResponsesCacheRender({
        baseUrl: "https://proxy.example/v1",
        provider: "openrouter",
        modelId: "unknown-responses-model",
        sessionId: "session-proxy",
        policy: {
          retention: "long",
          writeMode: "readWrite",
          scope: "session",
          reason: "config",
        },
      }),
    ).toEqual({
      status: "unsupported",
      reason: "provider_model_does_not_advertise_prompt_cache_key",
      renderedRetention: "none",
      bucketKey: "openai-responses|session=session-proxy|retention=none|writeMode=readWrite",
      capability: expect.objectContaining({
        strategies: ["implicitPrefix"],
        cacheCounters: "none",
      }),
      promptCacheKey: undefined,
      promptCacheRetention: undefined,
    });
  });

  test("resolves provider and model specific cache capabilities", () => {
    expect(
      resolveProviderCacheCapability({
        api: "openai-responses",
        provider: "openai",
        modelId: "gpt-5.4",
        baseUrl: "https://api.openai.com/v1",
        transport: "sse",
      }),
    ).toEqual(
      expect.objectContaining({
        strategies: ["promptCacheKey"],
        cacheCounters: "readOnly",
        longRetention: "24h",
      }),
    );
    expect(
      resolveProviderCacheCapability({
        api: "openai-responses",
        provider: "openai",
        modelId: "gpt-5.4",
        baseUrl: "https://api.openai.com/v1",
        transport: "sse",
      }).continuation,
    ).toBeUndefined();

    expect(
      resolveProviderCacheCapability({
        api: "openai-codex-responses",
        provider: "openai-codex",
        modelId: "gpt-5.4-codex",
        baseUrl: "https://chatgpt.com/backend-api",
        transport: "websocket",
      }),
    ).toEqual(
      expect.objectContaining({
        strategies: ["promptCacheKey"],
        cacheCounters: "readOnly",
        continuation: {
          family: "openai-responses",
          modes: ["websocketConnection", "previousResponseId"],
          authority: "efficiency",
          reason: "openai_codex_websocket_previous_response_id_affinity",
        },
      }),
    );

    expect(
      resolveProviderCacheCapability({
        api: "openai-responses",
        provider: "openrouter",
        modelId: "unknown-responses-model",
        baseUrl: "https://proxy.example/v1",
        transport: "sse",
      }),
    ).toEqual(
      expect.objectContaining({
        strategies: ["implicitPrefix"],
        cacheCounters: "none",
        reason: "provider_model_does_not_advertise_prompt_cache_key",
      }),
    );
  });

  test("reports read-only cache mode as unsupported when providers cannot honor it", () => {
    const openai = resolveOpenAIResponsesCacheRender({
      baseUrl: "https://api.openai.com/v1",
      sessionId: "session-read-only",
      policy: {
        retention: "short",
        writeMode: "readOnly",
        scope: "session",
        reason: "config",
      },
    });
    expect(openai).toEqual(
      expect.objectContaining({
        status: "unsupported",
        reason: "cache_write_mode_read_only_not_supported",
        renderedRetention: "none",
      }),
    );
    expect(openai.promptCacheKey).toBeUndefined();
    expect(openai.promptCacheRetention).toBeUndefined();

    const anthropic = resolveAnthropicCacheRender({
      baseUrl: "https://api.anthropic.com",
      sessionId: "session-read-only",
      policy: {
        retention: "short",
        writeMode: "readOnly",
        scope: "session",
        reason: "config",
      },
    });
    expect(anthropic).toEqual(
      expect.objectContaining({
        status: "unsupported",
        reason: "cache_write_mode_read_only_not_supported",
        renderedRetention: "none",
      }),
    );
    expect(anthropic.cacheControl).toBeUndefined();

    const bedrock = resolveBedrockCacheRender({
      modelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
      forceCache: true,
      sessionId: "session-read-only",
      policy: {
        retention: "short",
        writeMode: "readOnly",
        scope: "session",
        reason: "config",
      },
    });
    expect(bedrock).toEqual(
      expect.objectContaining({
        status: "unsupported",
        reason: "cache_write_mode_read_only_not_supported",
        renderedRetention: "none",
      }),
    );
    expect(bedrock.cachePoint).toBeUndefined();
  });

  test("renders Anthropic long retention only for direct Anthropic requests", () => {
    expect(
      resolveAnthropicCacheRender({
        baseUrl: "https://api.anthropic.com",
        sessionId: "session-anthropic",
        policy: {
          retention: "long",
          writeMode: "readWrite",
          scope: "session",
          reason: "config",
        },
      }),
    ).toEqual({
      status: "rendered",
      reason: "rendered_anthropic_cache_control",
      renderedRetention: "long",
      bucketKey: "anthropic-messages|session=session-anthropic|retention=long|writeMode=readWrite",
      capability: expect.objectContaining({
        strategies: ["explicitCacheMarker"],
        cacheCounters: "readWrite",
        longRetention: "1h",
      }),
      cacheControl: { type: "ephemeral", ttl: "1h" },
    });

    expect(
      resolveAnthropicCacheRender({
        baseUrl: "https://proxy.example",
        sessionId: "session-anthropic-proxy",
        policy: {
          retention: "long",
          writeMode: "readWrite",
          scope: "session",
          reason: "config",
        },
      }),
    ).toEqual({
      status: "degraded",
      reason: "long_retention_requires_direct_anthropic_base_url",
      renderedRetention: "short",
      bucketKey:
        "anthropic-messages|session=session-anthropic-proxy|retention=short|writeMode=readWrite",
      capability: expect.objectContaining({
        strategies: ["explicitCacheMarker"],
        longRetention: "none",
      }),
      cacheControl: { type: "ephemeral" },
    });
  });

  test("reports unsupported Bedrock cache points with readable reasons", () => {
    expect(
      resolveBedrockCacheRender({
        modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        forceCache: false,
        sessionId: "session-bedrock-sonnet-v2",
        policy: {
          retention: "short",
          writeMode: "readWrite",
          scope: "session",
          reason: "default",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "rendered",
        reason: "rendered_bedrock_cache_point",
      }),
    );

    expect(
      resolveBedrockCacheRender({
        modelId: "amazon.nova-pro-v1:0",
        forceCache: false,
        sessionId: "session-bedrock",
        policy: {
          retention: "short",
          writeMode: "readWrite",
          scope: "session",
          reason: "default",
        },
      }),
    ).toEqual({
      status: "unsupported",
      reason: "bedrock_model_does_not_support_explicit_cache_points",
      renderedRetention: "none",
      bucketKey:
        "bedrock-converse-stream|session=session-bedrock|retention=none|writeMode=readWrite",
      capability: expect.objectContaining({
        strategies: ["unsupported"],
        cacheCounters: "none",
      }),
      cachePoint: undefined,
    });
  });
});
