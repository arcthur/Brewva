# Reference: Token Cache

Implementation anchors:

- `packages/brewva-provider-core/src/cache-policy.ts`
- `packages/brewva-provider-core/src/providers/payload-metadata.ts`
- `packages/brewva-provider-core/src/providers/anthropic.ts`
- `packages/brewva-provider-core/src/providers/openai-responses.ts`
- `packages/brewva-provider-core/src/providers/openai-codex-responses.ts`
- `packages/brewva-provider-core/src/providers/amazon-bedrock.ts`
- `packages/brewva-gateway/src/cache/`
- `packages/brewva-gateway/src/host/managed-agent-session.ts`
- `packages/brewva-gateway/src/host/hosted-session-bootstrap.ts`
- `packages/brewva-gateway/src/runtime-plugins/provider-request-reduction.ts`
- `packages/brewva-runtime/src/contracts/context.ts`

## Role

Provider token cache is an efficiency plane.

It can reduce latency and provider input cost, but it is never replay
authority. WAL, event tape, proposals, receipts, task/truth state, and
rollback material remain the only authority-bearing surfaces.

Token-cache state is rebuildable and disposable:

- provider cache policy
- rendered provider cache result
- request fingerprint
- cache-break observation
- read-unchanged state
- sticky capability latches
- optional diagnostic dump files

These objects may support inspection and cost diagnosis. They must not be used
to reconstruct file contents, tool effects, session history, approvals, or
recovery truth.

## Cache Policy

The provider-neutral policy shape is `ProviderCachePolicy`:

- `retention`: `none`, `short`, or `long`
- `writeMode`: `readWrite` or `readOnly`
- `scope`: currently `session`
- `reason`: `default`, `config`, `provider_fallback`, `pressure`,
  `disabled`, or a provider-readable extension reason

Default policy:

- `retention=short`
- `writeMode=readWrite`
- `scope=session`
- `reason=default`

The old bare `cacheRetention` meaning is not a supported contract. New code
must pass the object-shaped `cachePolicy` through the hosted path:

1. hosted settings
2. managed session creation
3. agent-engine stream options
4. provider-core stream options
5. provider renderer

Provider-core is the only layer that renders provider-specific cache fields.
Gateway and runtime receive provider-neutral render metadata and normalized
usage counters.

## Provider Strategies

Provider capability is resolved by provider-core from API, provider, concrete
model, base URL, and transport. The normalized strategy vocabulary is:

- `explicitCacheMarker`
  - Anthropic Messages and supported Bedrock Claude models render provider
    cache markers or Bedrock cache points.
  - Anthropic direct API may use bounded multi-breakpoint placement across
    system, tools, message prefix, and current turn.
- `promptCacheKey`
  - OpenAI Responses, OpenAI Codex Responses, and Azure OpenAI Responses can use
    a stable prompt cache key when the provider/model supports it.
  - Direct OpenAI can expose longer prompt-cache retention where supported.
- `implicitPrefix`
  - Providers such as Gemini, OpenAI-compatible completions, and Mistral may
    rely on provider-side implicit prefix behavior when no explicit cache field
    is supported.
- `unsupported`
  - Provider-core must return a readable reason instead of silently pretending
    the requested cache policy was honored.

`writeMode=readOnly` is only valid when a provider can actually honor it. If a
provider cannot honor read-only cache semantics, rendering returns an
unsupported or degraded result with a readable reason.

## GPT And Codex Continuation

OpenAI-family prompt caching is not Claude-style cache markers. Brewva models
GPT and Codex behavior through provider-core capabilities:

- prompt-cache key for Responses-style APIs
- WebSocket connection affinity when the Codex path uses WebSocket transport
- `previous_response_id` delta submission when a previous response is available

Codex continuation state is scoped by session and model. A session that switches
models must not reuse the previous model's continuation chain.

Continuation is an efficiency hint, not replay authority. The local conversation
history stays intact. Provider-core may send a reduced outbound copy when the
previous request, previous response, and current input form a valid continuation
chain.

## Stable Prefix Boundary

Token cache works only when the provider-visible prefix stays stable. Brewva
therefore treats the stable prefix as a hosted-session asset.

Stable prefix candidates:

- Brewva base instructions
- stable runtime contract language
- stable session-owned tool schema snapshots
- stable capability declarations
- session-level context that has explicit epoch ownership

Dynamic-tail candidates:

- current turn content
- context pressure and budget details
- transient request-reduction summaries
- recall and DuckDB session-index injections
- skill-routing diagnostics and readiness state
- Telegram, ingress, schedule, heartbeat, and other channel-derived context
- cache diagnostics
- time-sensitive or freshness-sensitive state

Recall, skill routing, and channel-derived context must not drift silently into
the stable prefix. They either stay in the dynamic tail or advance an explicit
epoch.

## Tool Schema Snapshots

The hosted session owns a session-stable tool schema snapshot. The snapshot
stores:

- deterministic tool order
- aggregate snapshot hash
- per-tool hashes
- tool schema epoch
- invalidation reason

It is rebuilt only for cache-relevant tool-surface changes:

- active managed tool set changes
- dynamic tool source changes
- capability declaration changes
- provider-family schema-shape changes
- session clear, compaction, or replacement

Provider-specific cache controls are overlays on top of the stable base. They
must not mutate the base tool schema bytes.

## Request Fingerprint

Gateway builds a `ProviderRequestFingerprint` after final provider payload
assembly and before streaming. Fingerprints are compared only inside a provider
cache bucket.

The bucket is narrower than the fingerprint and includes provider family/API,
model, cache scope, retention, write mode, and provider cache key. Transport is
a fingerprint field rather than a bucket field unless the provider cache is
actually transport-scoped. This keeps `transport=auto` from splitting the same
provider cache line after runtime negotiation.

Fingerprint fields include:

- provider, API, model, and transport
- cache policy hash
- rendered cache shape hash
- provider cache capability hash
- stable prefix hash
- dynamic tail hash
- full request hash
- tool snapshot hash
- tool overlay hash
- per-tool hashes
- active skill set and skill-routing epoch
- recall injection hash
- channel context hash
- reasoning and thinking-budget hashes
- sticky latch hash
- cache-relevant headers and extra body hash
- visible-history reduction hash
- provider fallback hash

Fingerprints contain hashes and safe labels, not raw prompt content, credentials,
or provider secrets.

## Break Detection

Gateway compares the current fingerprint and normalized provider usage counters
against the previous comparable request in the same cache bucket.

Unexpected break detection uses noise gates:

- minimum missed-cache token threshold: `2000`
- relative drop threshold: `5%`
- TTL-expiry classification for likely provider expiry
- degraded-observability classification when cache counters are unavailable
- provider/model exclusions for incompatible cache behavior

Expected breaks are declared upstream and consumed by the detector. Examples:

- prefix-resetting provider request reduction
- compaction or visible-history reset
- provider/model fallback
- provider cache-edit deletion

An expected break rebases detector state instead of producing an unexpected
warning.

When explicitly configured, unexpected break diagnostics may be dumped to a
local non-authoritative directory. `BREWVA_CACHE_BREAK_DUMP_DIR` is the
preferred override. `BREWVA_PROVIDER_CACHE_DEBUG_DIR` remains accepted. These
files are for local forensics only and do not enter WAL, event tape, or replay.

## Read-Unchanged Reduction

The hosted read wrapper can replace repeated identical full-text reads with a
compact unchanged result when all of these are true:

- same session
- same normalized absolute path
- same offset, limit, and encoding
- file signature matches
- prior full content is still visible in the current provider history

The file signature uses size and mtime. For files up to the bounded content-hash
threshold, the hosted wrapper also records a SHA-256 content hash so same-size
same-mtime changes cannot be treated as unchanged.

Visibility is checked through runtime visible-read state, not by trusting the
read cache alone. Runtime clears remembered visible read states when the
visible-read epoch advances.

Read-unchanged state is cleared or invalidated on:

- file signature change
- session clear
- compaction that removes prior full content from visible context
- session replacement
- explicit visible-history epoch advance

This is a token optimization only. File authority remains with substrate reads,
tool receipts, and replay-visible events.

## Request Reduction Policy

Provider request reduction classifies outbound reductions as:

- `prefixPreserving`
- `prefixResetting`
- `providerEdit`
- `cacheCold`

The reduction plugin compares immediate token savings against likely warm-cache
value. It can skip reduction when the provider cache is warm and the immediate
savings are smaller than expected cache-read loss.

Prefix-resetting reductions are reported as expected cache breaks. `providerEdit`
is a classification and future-provider hook; Brewva does not fake provider
cache-edit behavior unless provider-core actually supports it.

## Lifecycle

Session-local cache state is cleared or epoch-advanced on:

- session clear
- session replacement
- explicit compaction
- model or provider family change
- tool schema epoch change
- cache policy disablement
- visible-history reset

The lifecycle covers:

- provider cache detector baselines
- tool schema snapshot store
- sticky capability latches
- read-unchanged state
- prompt-stability observations
- expected-break markers
- source-text caches tied to visible session behavior, including TOC cache

There is intentionally no global cache manager. Each bounded cache keeps its own
implementation, but they share the same invalidation vocabulary.

## Inspect Surfaces

Runtime exposes token-cache diagnostics through live, non-authoritative
inspection:

- `inspect.context.getProviderCacheObservation(sessionId)`
- `inspect.context.getVisibleReadEpoch(sessionId)`
- `inspect.context.isVisibleReadStateCurrent(sessionId, state)`

Maintenance surfaces may observe cache state and advance visible-read epochs,
but these remain session-local diagnostic or lifecycle operations. They do not
create durable event families.

## Verification

Current regression coverage includes:

- provider-core cache policy and provider render behavior
- Anthropic multi-breakpoint cache marker placement
- OpenAI Codex WebSocket plus `previous_response_id` continuation
- provider request fingerprint attribution and cache-break detector behavior
- expected-break rebasing
- degraded observability and TTL classification
- session-stable tool schema snapshots
- read-unchanged invalidation on visible epoch and file content drift
- provider-request reduction warm-cache preservation
- runtime provider-cache inspection state
- full gpt-5.4 live prompt-cache and Codex continuation checks

Useful commands:

```bash
bun run check
bun test
BREWVA_TEST_LIVE=1 bun test test/live/provider/token-cache.live.test.ts
```

Live tests require a configured OpenAI/Codex auth environment. Non-live test
runs skip these checks.
