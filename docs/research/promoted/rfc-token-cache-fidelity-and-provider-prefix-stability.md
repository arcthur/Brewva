# Research: Token Cache Fidelity And Provider Prefix Stability

## Document Metadata

- Status: `promoted`
- Owner: gateway, agent-engine, provider-core, and runtime maintainers
- Last reviewed: `2026-04-26`
- Promotion target:
  - `docs/reference/token-cache.md`
  - `docs/reference/runtime.md`
  - `docs/reference/runtime-plugins.md`
  - `docs/reference/context-composer.md`
  - `docs/reference/configuration.md`
  - `docs/architecture/system-architecture.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- provider token cache is an efficiency plane, not replay authority
- hosted sessions carry an object-shaped `cachePolicy`; there is no
  `cacheRetention` compatibility alias
- provider-specific cache features stay inside provider-core renderers
- gateway owns request fingerprints, cache-break observations, sticky
  capability latches, session-stable tool schema snapshots, and debug dumps
- runtime exposes provider-cache observations and visible-read state as live,
  rebuildable inspection surfaces
- request-local reductions may optimize outbound provider payloads, but they do
  not rewrite WAL, event tape, proposals, receipts, or local conversation
  authority

## Stable References

- `docs/reference/token-cache.md`
- `docs/reference/runtime.md`
- `docs/reference/runtime-plugins.md`
- `docs/reference/context-composer.md`
- `docs/reference/configuration.md`
- `docs/architecture/system-architecture.md`

## Promoted Contract

The promoted contract includes:

- provider-neutral `ProviderCachePolicy` with `retention`, `writeMode`,
  `scope`, and `reason`
- provider strategies for explicit cache markers, prompt-cache keys,
  implicit-prefix providers, unsupported providers, and Codex continuation
- session-stable tool schema snapshots with aggregate and per-tool hashes
- provider request fingerprints that include cache policy, rendered cache
  shape, sticky latches, tool schema, skill routing, recall, channel context,
  reasoning settings, provider fallback, and visible-history reduction hashes
- cache-break detection with absolute and relative thresholds, expected-break
  rebasing, TTL/degraded-observability classification, and optional local dumps
- read-unchanged reduction tied to file signatures and runtime visible-read
  state
- cache-aware provider request reduction that can preserve a warm provider
  cache when reduction would cost more than it saves
- lifecycle clearing for clear, compact, session replacement,
  model/provider switch, tool epoch change, and visible-history reset

## Implementation Anchors

- `packages/brewva-provider-core/src/cache-policy.ts`
- `packages/brewva-provider-core/src/providers/payload-metadata.ts`
- `packages/brewva-agent-engine/src/agent-engine-types.ts`
- `packages/brewva-agent-engine/src/provider-stream.ts`
- `packages/brewva-gateway/src/cache/`
- `packages/brewva-gateway/src/host/managed-agent-session.ts`
- `packages/brewva-gateway/src/host/hosted-session-bootstrap.ts`
- `packages/brewva-gateway/src/host/hosted-settings-backend.ts`
- `packages/brewva-gateway/src/runtime-plugins/provider-request-reduction.ts`
- `packages/brewva-runtime/src/contracts/context.ts`
- `packages/brewva-runtime/src/runtime-method-groups.ts`
- `packages/brewva-runtime/src/services/context.ts`
- `packages/brewva-runtime/src/services/session-state.ts`

## Validation Status

Promotion is backed by current regression coverage for:

- provider-core cache policy rendering and unsupported/degraded reasons
- Anthropic multi-breakpoint cache marker placement
- Bedrock model cache-point eligibility
- OpenAI Responses prompt-cache keys
- OpenAI Codex WebSocket plus `previous_response_id` continuation
- gateway fingerprint attribution and per-tool drift detection
- expected-break rebasing and unexpected break observation
- degraded observability and TTL classification
- sticky cache-capability latches
- session-stable tool schema snapshots
- read-unchanged invalidation on visible epoch and file content drift
- runtime provider-cache inspection and visible-read state
- provider-request reduction warm-cache preservation
- live GPT prompt-cache and Codex continuation behavior when credentials are
  configured

Current verification commands used during promotion:

- `bun run check`
- `bun test`
- `BREWVA_TEST_LIVE=1 bun test test/live/provider/token-cache.live.test.ts`
- `bun run format:docs:check`
- `bun run test:docs`

## Remaining Backlog

- `providerEdit` is a classification and future-provider hook until a provider
  renderer exposes true cache-edit semantics.
- Future provider-specific continuation modes should start in provider-core
  capability/render contracts, not gateway conditionals.
- Kimi Code safe-degraded cache handling is promoted separately in
  `docs/research/promoted/rfc-kimi-code-token-cache-adapter.md`. Native Kimi
  Code cache support beyond that guard should start from a new focused RFC once
  the provider behavior is documented or repeatably live-verifiable.
- If operational diagnostics become noisy, tune detector thresholds and dump
  contents in `docs/reference/token-cache.md` and tests instead of reopening
  this promoted pointer.

## Historical Notes

The active RFC compared Claude-style cache markers, GPT prompt-cache keys,
Codex continuation, implicit-prefix providers, session-stable tool schemas,
read-unchanged reduction, and replay-safe request reduction. The accepted
contract is now carried by the stable docs listed above.
