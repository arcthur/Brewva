# Research: Hosted Thread Loop And Unified Recovery Decisions

## Document Metadata

- Status: `promoted`
- Owner: runtime and gateway maintainers
- Last reviewed: `2026-04-20`
- Promotion target:
  - `docs/architecture/system-architecture.md`
  - `docs/reference/session-lifecycle.md`
  - `docs/reference/runtime-plugins.md`
  - `docs/journeys/internal/context-and-compaction.md`
  - `docs/reference/gateway-control-plane-protocol.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- `HostedThreadLoop` is the gateway-internal continuation owner above the
  low-level agent loop.
- `packages/brewva-agent-engine/src/agent-loop.ts` remains the low-level
  model/tool primitive for streaming, tool calls, queued prompts, in-flight
  steer application, follow-up messages, request authorization, and context
  transformation.
- hosted entrypoints enter the canonical hosted turn envelope, which resolves
  explicit profiles before running the loop: `interactive`, `print`,
  `channel`, `scheduled`, `heartbeat`, `wal_recovery`, or `subagent`.
- hosted recovery decisions use one turn-local `ThreadLoopState` projection and
  a small `ThreadLoopDecision` union.
- `HostedTurnTransitionCoordinator` remains event-derived transition, breaker,
  and audit state; it is not the business-policy engine.
- runtime/kernel mechanisms remain authoritative for effect approval, rollback,
  Recovery WAL, receipts, and replay-visible history rewrites.
- `ThreadLoopState` and diagnostics stay gateway internal and sanitized.
- Detailed recovery history stays process-local. Durable recovery explanation is
  the bounded transition receipt stream plus authority receipts, not a verbose
  serialized copy of loop-local recovery state.

## Stable References

- `docs/architecture/system-architecture.md`
- `docs/reference/session-lifecycle.md`
- `docs/reference/runtime-plugins.md`
- `docs/journeys/internal/context-and-compaction.md`
- `docs/reference/gateway-control-plane-protocol.md`

## Current Implementation Notes

Implemented files:

- `packages/brewva-gateway/src/session/thread-loop-types.ts`
- `packages/brewva-gateway/src/session/thread-loop-profiles.ts`
- `packages/brewva-gateway/src/session/thread-loop-decision-resolver.ts`
- `packages/brewva-gateway/src/session/hosted-thread-loop.ts`
- `packages/brewva-gateway/src/session/compaction-generation-coordinator.ts`
- `packages/brewva-gateway/src/session/hosted-prompt-attempt.ts`
- `packages/brewva-gateway/src/session/error-classification.ts`
- `packages/brewva-gateway/src/session/turn-envelope.ts`
- `packages/brewva-gateway/src/host/run-hosted-prompt-turn.ts`

Routed entrypoints:

- worker turns in `packages/brewva-gateway/src/session/worker-main.ts`
- channel turns in `packages/brewva-gateway/src/channels/channel-agent-dispatch.ts`
- CLI print turns in `packages/brewva-cli/src/cli-runtime.ts`
- shell/TUI prompt ports in `packages/brewva-cli/src/shell/adapters/ports.ts`
- subagent turns in `packages/brewva-gateway/src/subagents/orchestrator.ts`
- subagent runner turns in `packages/brewva-gateway/src/subagents/runner-main.ts`

Removed or collapsed old orchestration:

- `sendPromptWithCompactionRecovery(...)` is no longer a public callable path.
- the compaction controller no longer assigns `session.prompt = promptWrapper`.
- `collect-output.ts` no longer owns a nested recovery retry loop.
- prompt failure classification is shared through `error-classification.ts`.
- `yield_to_operator` is not part of `ThreadLoopDecision`; generic operator
  delegation should not be added without a concrete resume protocol.

## Final Architecture Review

The implementation resolves the original architecture problem: hosted turns now
have one explicit owner for "what happens next."

Strengths:

- active compaction no longer completes an empty turn as success; the resolver
  can return `compact_resume_stream`, and the loop dispatches the resume prompt
  through the normal attempt path
- embedded CLI and TUI prompt paths enter the canonical hosted turn envelope
  through `runHostedPromptTurn(...)` for ordinary non-streaming interactive and
  print prompts
- every decision in the union is produced and handled by the loop
- reasoning-revert resume is represented as `revert_then_stream`
- deterministic compaction settlement is separate from compact-resume dispatch
- provider fallback and max-output breaker/failure paths abort remaining
  policies explicitly
- subagent turns use a profile that disables provider fallback recovery
- production entrypoints no longer resolve profiles or call
  `HostedThreadLoop` directly; they enter the canonical hosted turn envelope
- diagnostics omit prompt text and provider payloads
- detailed recovery history is not promoted into durable transition payloads;
  durable transition payloads stay bounded to replayable reason/status facts

Boundary assessment:

- no public `BrewvaRuntime` API widening
- no new durable history rewrite authority
- no bypass around effect governance or rollback
- no compatibility adapter for the old prompt recovery helper
- no `session.prompt` monkey-patch lifecycle
- `ManagedAgentSession.prompt(...)` remains acceptable as a session-facing API
  and streaming follow-up surface, but new hosted prompt entrypoints should
  enter `runHostedTurnEnvelope(...)`

Residual risks are maintainability risks:

- `hosted-thread-loop.ts` is large; if it grows, extract failure recovery
  resolution and result projection into sibling internal modules instead of
  adding another nested loop
- `compaction-recovery.ts` remains large; it no longer monkey-patches prompt
  dispatch, but policy execution can be split later if responsibilities drift
- future hosted entrypoints should be guarded by tests or import-boundary
  checks so they do not bypass `runHostedTurnEnvelope(...)`

## Promoted Contract Checklist

- [x] Hosted turn execution has a named thread-loop owner.
- [x] Recovery decisions use one turn-local `ThreadLoopState` projection.
- [x] Prompt recovery policies no longer recursively dispatch prompts from a
      public exception-only policy chain.
- [x] Reasoning-revert resume is represented as a loop decision.
- [x] Effect-commitment approval wait is represented as a suspension decision
      with a deterministic resume path.
- [x] Foreground and background compaction recovery have one generation
      coordinator and no prompt monkey-patch.
- [x] Fast-path profiles are explicit and covered by tests.
- [x] Existing durability contracts remain intact:
  - turn receipts remain authoritative and are owned by the canonical hosted
    turn envelope
  - Recovery WAL remains authoritative for in-flight replay
  - `session_compact` remains the replay-visible history rewrite authority
  - transition snapshots remain rebuildable from events
- [x] Stable architecture, reference, and journey docs carry the accepted
      hosted-loop contract.
- [x] Detailed recovery history durable projection decision is closed:
      process-local diagnostics stay process-local, while durable recovery
      explanation uses transition and authority receipts.

## Non-Goals

- Rewriting the agent engine.
- Removing Gateway, Channel, WAL, receipts, or transition events.
- Making the transition coordinator a business-policy engine.
- Adding a second durable history rewrite authority.
- Making ordinary fast paths skip effect governance.
- Introducing cross-agent saga or compensation semantics.
- Adding verbose loop-local recovery diagnostics to durable transition payloads.

## Closed Implementation Posture

This RFC has no remaining implementation backlog. Static import and
receipt-writer boundary tests remain ordinary maintenance when new hosted
entrypoints are added. Large internal files should be split only when
responsibility drift appears, not as unfinished loop architecture.
