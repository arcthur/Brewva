import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProviderCacheBreakDetector,
  ProviderCacheStickyLatches,
  createProviderRequestFingerprint,
  createToolSchemaSnapshot,
  createToolSchemaSnapshotStore,
} from "../../../packages/brewva-gateway/src/cache/index.js";

describe("provider cache fingerprinting", () => {
  test("attributes tool schema drift with per-tool hashes", () => {
    const previous = createToolSchemaSnapshot([
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
      {
        name: "write",
        description: "Write a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);
    const next = createToolSchemaSnapshot([
      {
        name: "write",
        description: "Write a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
      {
        name: "read",
        description: "Read a file safely",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);

    expect(previous.hash).not.toBe(next.hash);
    expect(previous.perToolHashes.write).toBe(next.perToolHashes.write);
    expect(previous.perToolHashes.read).not.toBe(next.perToolHashes.read);
  });

  test("keeps a session-stable tool schema snapshot across same-name drift", () => {
    const store = createToolSchemaSnapshotStore();
    const first = store.resolve(
      [
        {
          name: "read",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      "initial",
    );

    const drifted = store.resolve(
      [
        {
          name: "read",
          description: "Read a file with dynamic refreshed prose",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      "runtime_refresh",
    );

    expect(drifted.epoch).toBe(first.epoch);
    expect(drifted.hash).toBe(first.hash);
    expect(drifted.tools[0]?.description).toBe("Read a file");
    expect(drifted.driftedToolNames).toEqual(["read"]);

    const changedSet = store.resolve(
      [
        {
          name: "read",
          description: "Read a file with dynamic refreshed prose",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          name: "write",
          description: "Write a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
      "active_tool_set_changed",
    );

    expect(changedSet.epoch).toBe(first.epoch + 1);
    expect(changedSet.hash).not.toBe(first.hash);
    expect(changedSet.invalidationReason).toBe("active_tool_set_changed");
  });

  test("keeps recall and channel context in dynamic-tail hashes", () => {
    const snapshot = createToolSchemaSnapshot([]);
    const fingerprint = createProviderRequestFingerprint({
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4",
      transport: "sse",
      sessionId: "session-cache",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: snapshot,
      stablePrefixParts: ["system prompt", "stable tool prelude"],
      dynamicTailParts: ["recall injection", "telegram channel context"],
      activeSkillSet: ["review"],
      skillRoutingEpoch: 2,
      channelContext: "telegram",
      renderedCache: {
        status: "rendered",
        reason: "rendered_openai_prompt_cache",
        renderedRetention: "short",
        bucketKey: "openai-responses|session=session-cache|retention=short|writeMode=readWrite",
        capability: {
          strategies: ["promptCacheKey"],
          cacheCounters: "readOnly",
          shortRetention: true,
          longRetention: "24h",
          readOnlyWriteMode: "unsupported",
          reason: "openai_responses_prompt_cache_key",
        },
      },
      stickyLatches: {
        providerCacheRetained: true,
        providerCacheEdit: false,
        lowLatencyTransport: false,
        reasoningTransport: true,
        channelCapability: true,
      },
      reasoning: "high",
      thinkingBudgets: { high: 16_384 },
      cacheRelevantHeaders: { "x-provider-beta": "cache-control" },
      extraBody: { output_config: { effort: "high" } },
      visibleHistoryReduction: { epoch: 1, status: "none" },
      recallInjection: { present: true, scope: "dynamic_tail" },
      providerFallback: { active: false },
      payload: {
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hello" }],
        apiKey: "redacted by hash",
      },
    });

    expect(fingerprint.stablePrefixHash).not.toBe(fingerprint.dynamicTailHash);
    expect(fingerprint.activeSkillSetHash).not.toBe("");
    expect(fingerprint.skillRoutingEpoch).toBe(2);
    expect(fingerprint.channelContextHash).not.toBe("");
    expect(fingerprint.renderedCacheHash).not.toBe("");
    expect(fingerprint.cacheCapabilityHash).not.toBe("");
    expect(fingerprint.stickyLatchHash).not.toBe("");
    expect(fingerprint.reasoningHash).not.toBe("");
    expect(fingerprint.thinkingBudgetHash).not.toBe("");
    expect(fingerprint.cacheRelevantHeadersHash).not.toBe("");
    expect(fingerprint.extraBodyHash).not.toBe("");
    expect(fingerprint.visibleHistoryReductionHash).not.toBe("");
    expect(fingerprint.recallInjectionHash).not.toBe("");
    expect(fingerprint.providerFallbackHash).not.toBe("");
    expect(fingerprint.requestHash).not.toContain("redacted by hash");
  });

  test("suppresses expected breaks while surfacing unexpected cache-read drops", () => {
    const detector = new ProviderCacheBreakDetector();
    const baseFingerprint = createProviderRequestFingerprint({
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4",
      transport: "sse",
      sessionId: "session-cache-break",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: createToolSchemaSnapshot([]),
      stablePrefixParts: ["stable"],
      dynamicTailParts: ["tail"],
      activeSkillSet: [],
      skillRoutingEpoch: 0,
      channelContext: "",
      payload: { input: "first" },
    });

    expect(
      detector.observe({
        source: "session-cache-break",
        fingerprint: baseFingerprint,
        usage: { cacheRead: 10_000, cacheWrite: 500 },
      }),
    ).toEqual(expect.objectContaining({ status: "cold" }));

    const expectedBreak = detector.observe({
      source: "session-cache-break",
      fingerprint: { ...baseFingerprint, requestHash: "expected-reset" },
      usage: { cacheRead: 0, cacheWrite: 10_500 },
      expectedBreak: { classification: "prefixResetting", reason: "cache_deletions_pending" },
    });
    expect(expectedBreak).toEqual(
      expect.objectContaining({
        status: "break",
        expected: true,
        classification: "prefixResetting",
      }),
    );

    const unexpectedSource = "session-cache-break-unexpected";
    detector.observe({
      source: unexpectedSource,
      fingerprint: baseFingerprint,
      usage: { cacheRead: 10_000, cacheWrite: 500 },
    });
    const unexpectedBreak = detector.observe({
      source: unexpectedSource,
      fingerprint: { ...baseFingerprint, requestHash: "unexpected-reset" },
      usage: { cacheRead: 1_000, cacheWrite: 9_500 },
    });
    expect(unexpectedBreak).toEqual(
      expect.objectContaining({
        status: "break",
        expected: false,
        classification: "prefixPreserving",
        cacheMissTokens: 9_000,
      }),
    );
  });

  test("keeps no-op turns warm when cache-read tokens do not drop", () => {
    const detector = new ProviderCacheBreakDetector();
    const fingerprint = createProviderRequestFingerprint({
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4",
      transport: "sse",
      sessionId: "warm-noop",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: createToolSchemaSnapshot([]),
      stablePrefixParts: ["stable"],
      dynamicTailParts: [{ lastMessages: [] }],
      activeSkillSet: [],
      skillRoutingEpoch: 0,
      channelContext: "",
      payload: { input: "same" },
    });

    detector.observe({
      source: fingerprint.bucketKey,
      fingerprint,
      usage: { cacheRead: 4_000, cacheWrite: 200 },
    });
    expect(
      detector.observe({
        source: fingerprint.bucketKey,
        fingerprint,
        usage: { cacheRead: 4_500, cacheWrite: 0 },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "warm",
        cacheMissTokens: 0,
      }),
    );
  });

  test("advances the baseline after an expected cache break", () => {
    const detector = new ProviderCacheBreakDetector();
    const fingerprint = createProviderRequestFingerprint({
      provider: "openai",
      api: "openai-responses",
      model: "gpt-5.4",
      transport: "sse",
      sessionId: "expected-break-baseline",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: createToolSchemaSnapshot([]),
      stablePrefixParts: ["stable"],
      dynamicTailParts: ["tail"],
      activeSkillSet: [],
      skillRoutingEpoch: 0,
      channelContext: "",
      payload: { input: "first" },
    });

    detector.observe({
      source: fingerprint.bucketKey,
      fingerprint,
      usage: { cacheRead: 10_000, cacheWrite: 500 },
    });
    detector.observe({
      source: fingerprint.bucketKey,
      fingerprint: { ...fingerprint, requestHash: "expected-reset" },
      usage: { cacheRead: 0, cacheWrite: 10_500 },
      expectedBreak: { classification: "prefixResetting", reason: "cache_deletions_pending" },
    });

    expect(
      detector.observe({
        source: fingerprint.bucketKey,
        fingerprint: { ...fingerprint, requestHash: "post-reset" },
        usage: { cacheRead: 0, cacheWrite: 1_000 },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "warm",
        expected: false,
        cacheMissTokens: 0,
      }),
    );
  });

  test("reports limited observability when provider cache counters are unavailable", () => {
    const detector = new ProviderCacheBreakDetector();
    const fingerprint = createProviderRequestFingerprint({
      provider: "local",
      api: "openai-responses",
      model: "edge-model",
      transport: "sse",
      sessionId: "limited-observability",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: createToolSchemaSnapshot([]),
      stablePrefixParts: ["stable"],
      dynamicTailParts: ["tail"],
      activeSkillSet: [],
      skillRoutingEpoch: 0,
      channelContext: "",
      payload: { input: "first" },
    });

    const observation = detector.observe({
      source: fingerprint.bucketKey,
      fingerprint,
      usage: { cacheRead: 0, cacheWrite: 0 },
      observability: {
        cacheCountersAvailable: false,
        reason: "provider_cache_counters_unavailable",
      },
    });

    expect(observation).toEqual(
      expect.objectContaining({
        status: "limited",
        classification: "cacheCold",
        expected: false,
        reason: "provider_cache_counters_unavailable",
      }),
    );
  });

  test("dumps unexpected break diagnostics when explicitly enabled", () => {
    const diagnosticsDir = mkdtempSync(join(tmpdir(), "brewva-cache-break-"));
    try {
      const detector = new ProviderCacheBreakDetector({
        diagnosticDumpDirectory: diagnosticsDir,
      });
      const fingerprint = createProviderRequestFingerprint({
        provider: "openai",
        api: "openai-responses",
        model: "gpt-5.4",
        transport: "sse",
        sessionId: "dump-break",
        cachePolicy: {
          retention: "short",
          writeMode: "readWrite",
          scope: "session",
          reason: "default",
        },
        toolSchemaSnapshot: createToolSchemaSnapshot([]),
        stablePrefixParts: ["stable"],
        dynamicTailParts: ["tail"],
        activeSkillSet: [],
        skillRoutingEpoch: 0,
        channelContext: "",
        payload: { input: "first" },
      });

      detector.observe({
        source: fingerprint.bucketKey,
        fingerprint,
        usage: { cacheRead: 10_000, cacheWrite: 500 },
        observedAt: 1,
      });
      detector.observe({
        source: fingerprint.bucketKey,
        fingerprint: { ...fingerprint, requestHash: "unexpected-reset" },
        usage: { cacheRead: 0, cacheWrite: 10_000 },
        observedAt: 2,
      });

      expect(readdirSync(diagnosticsDir).some((file) => file.startsWith("cache-break-"))).toBe(
        true,
      );
    } finally {
      rmSync(diagnosticsDir, { force: true, recursive: true });
    }
  });

  test("treats zero reasoning budgets as reasoning disabled for sticky latches", () => {
    const latches = new ProviderCacheStickyLatches();
    expect(latches.observe({ reasoning: { thinkingBudgetTokens: 0 } }).reasoningTransport).toBe(
      false,
    );
    expect(latches.observe({ reasoning: { thinkingBudgetTokens: 1024 } }).reasoningTransport).toBe(
      true,
    );
    expect(latches.observe({ reasoning: { thinkingBudgetTokens: 0 } }).reasoningTransport).toBe(
      true,
    );
  });

  test("classifies likely TTL expiry separately from client-side drift", () => {
    const detector = new ProviderCacheBreakDetector();
    const fingerprint = createProviderRequestFingerprint({
      provider: "anthropic",
      api: "anthropic-messages",
      model: "claude-4-sonnet",
      transport: "sse",
      sessionId: "ttl-break",
      cachePolicy: {
        retention: "short",
        writeMode: "readWrite",
        scope: "session",
        reason: "default",
      },
      toolSchemaSnapshot: createToolSchemaSnapshot([]),
      stablePrefixParts: ["stable"],
      dynamicTailParts: ["tail"],
      activeSkillSet: [],
      skillRoutingEpoch: 0,
      channelContext: "",
      payload: { input: "same" },
    });

    detector.observe({
      source: fingerprint.bucketKey,
      fingerprint,
      usage: { cacheRead: 12_000, cacheWrite: 200 },
      observedAt: 0,
    });
    const observation = detector.observe({
      source: fingerprint.bucketKey,
      fingerprint,
      usage: { cacheRead: 100, cacheWrite: 12_000 },
      observedAt: 6 * 60 * 1000,
    });

    expect(observation).toEqual(
      expect.objectContaining({
        status: "break",
        expected: false,
        reason: "possible_cache_ttl_expiry_5m",
        changedFields: [],
      }),
    );
  });
});
