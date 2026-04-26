# Research: Kimi Code Token Cache Adapter

## Document Metadata

- Status: `promoted`
- Owner: provider-core and gateway maintainers
- Last reviewed: `2026-04-26`
- Promotion target:
  - `docs/reference/token-cache.md`
  - `packages/brewva-provider-core/src/cache-policy.ts`
  - `packages/brewva-provider-core/src/providers/anthropic.ts`
  - `packages/brewva-provider-core/src/providers/openai-completions.ts`
  - `packages/brewva-gateway/src/host/provider-connection.ts`
  - `test/unit/provider-core/cache-policy.unit.test.ts`
  - `test/live/provider/token-cache.live.test.ts`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- cache adaptation is provider-family-first and API-shape-second
- Kimi Code uses a safe-degraded provider-family guard until Kimi publishes or
  live validation proves a concrete cache contract
- Kimi Code must not inherit Anthropic `cache_control`, OpenAI
  `prompt_cache_key`, or Codex `previous_response_id` behavior from request
  envelope similarity
- Brewva exposes a single `Kimi` connect surface, but routes credentials and
  model catalogs to separate provider families:
  - `kimi-coding` for Kimi Code
  - `moonshot-cn` for Moonshot AI Open Platform (moonshot.cn)
  - `moonshot-ai` for Moonshot AI Open Platform (moonshot.ai)
- Moonshot Open Platform uses `kimi-k2.6` by default and keeps `kimi-k2.5`
  available; older K2 series ids are not part of the built-in Kimi surface
- Kimi credentials are provider-family-specific:
  - `KIMI_API_KEY`
  - `MOONSHOT_CN_API_KEY`
  - `MOONSHOT_AI_API_KEY`
- Brewva does not accept a generic `MOONSHOT_API_KEY` fallback because it cannot
  identify the intended `.cn` or `.ai` route without adding ambiguity

## Stable References

- `docs/reference/token-cache.md`
- `packages/brewva-provider-core/src/cache-policy.ts`
- `packages/brewva-provider-core/src/models.generated.ts`
- `packages/brewva-provider-core/src/providers/anthropic.ts`
- `packages/brewva-provider-core/src/providers/openai-completions.ts`
- `packages/brewva-provider-core/src/providers/payload-metadata.ts`
- `packages/brewva-gateway/src/host/provider-connection.ts`

## Stable Contract Summary

The promoted contract is:

1. `provider="kimi-coding"` or a base URL under `api.kimi.com/coding` resolves
   to unsupported cache capability with
   `reason="kimi_code_cache_contract_not_verified"`.
2. Kimi Code provider payloads do not receive Anthropic `cache_control` markers
   or GPT `prompt_cache_key` fields by inheritance.
3. Kimi Code does not claim Codex-style continuation or reuse continuation state
   across model switches.
4. Kimi-specific cache fields, counters, sticky latches, or continuation state
   may be added only through provider-core capability/render metadata after the
   provider behavior is documented or live-verified.
5. Gateway fingerprints may consume provider-neutral rendered cache metadata,
   but gateway must not branch on Kimi-specific payload fields or headers.
6. Missing Kimi cache counters are degraded observability, not an unexpected
   cache break.
7. Kimi Code and Moonshot Open Platform share a user-facing connect family but
   remain distinct provider families for credentials, model selection, endpoint
   routing, and cache semantics.

## Source Anchors

External references:

- Kimi Code provider documentation:
  `https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/providers-and-models.html`
- Kimi Code product page:
  `https://www.kimi.com/code/en`
- Kimi API model list:
  `https://platform.kimi.ai/docs/models`

## Validation Status

Promotion is backed by:

- provider-core cache-policy tests showing Kimi Code resolves to
  `kimi_code_cache_contract_not_verified`
- Anthropic breakpoint tests showing Kimi Code does not receive
  `cache_control`
- provider payload tests showing Kimi Code does not receive GPT
  `prompt_cache_key`
- model catalog tests showing Kimi Code uses `kimi-for-coding`, while
  Moonshot Open Platform exposes `kimi-k2.6` and `kimi-k2.5`
- gateway provider-connection tests showing the single `Kimi` connect surface
  routes selected credentials to the correct provider family
- runtime credential-vault tests showing only `KIMI_API_KEY`,
  `MOONSHOT_CN_API_KEY`, and `MOONSHOT_AI_API_KEY` are discovered
- live provider token-cache tests that are gated by credentials and assert the
  safe-degraded cache posture without inherited cache fields
- stable documentation in `docs/reference/token-cache.md`

Current verification commands used during promotion:

- `bun test test/unit/runtime/credential-vault.unit.test.ts test/unit/gateway/hosted-provider-helpers.unit.test.ts test/unit/gateway/provider-connection.unit.test.ts test/unit/provider-core/cache-policy.unit.test.ts test/unit/provider-core/model-catalog.unit.test.ts test/live/provider/token-cache.live.test.ts --timeout 600000`
- `bun test test/unit/gateway/hosted-session-driver.unit.test.ts test/unit/runtime/credential-vault.unit.test.ts test/unit/gateway/hosted-provider-helpers.unit.test.ts --timeout 600000`
- `bun run typecheck:test`
- `bun run format:check`
- `bun run test:docs`
- `git diff --check`

## Remaining Backlog

The following items are intentionally deferred and are not part of the promoted
contract:

- native Kimi Code token-cache support beyond safe-degraded behavior
- Moonshot Open Platform context-cache APIs
- Kimi models routed through OpenRouter or other aggregators
- provider-specific Kimi usage-counter normalization if future responses expose
  stable cache counters
- Kimi-specific session affinity, sticky latch, or continuation behavior if it
  becomes documented or repeatably live-verifiable

If future work changes those boundaries, it should start from a new focused RFC
rather than reopening this promoted pointer.

## Historical Notes

- Historical option analysis and incubation-stage rollout notes were removed
  from this file after promotion.
- The stable contract now lives in `docs/reference/token-cache.md`, provider
  code, gateway connection code, and regression tests.
