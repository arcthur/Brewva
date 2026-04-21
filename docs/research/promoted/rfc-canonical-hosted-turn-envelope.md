# Research: Canonical Hosted Turn Envelope

## Document Metadata

- Status: `promoted`
- Owner: gateway and runtime maintainers
- Last reviewed: `2026-04-21`
- Promotion target:
  - `docs/reference/session-lifecycle.md`
  - `docs/reference/runtime-plugins.md`
  - `docs/reference/events.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- `HostedThreadLoop` remains the gateway-internal attempt, continuation, and
  recovery body.
- production hosted prompt entrypoints enter through
  `packages/brewva-gateway/src/session/turn-envelope.ts`.
- the envelope owns hosted-loop profile resolution, runtime-turn binding,
  accepted-turn receipts, schedule-trigger prelude, WAL recovery transitions,
  terminal render receipts, and suspended-vs-terminal status mapping.
- every production accepted hosted prompt turn records `turn_input_recorded`.
- `turn_render_committed` is recorded only for terminal
  `completed | failed | cancelled` outcomes.
- approval `suspended` is not encoded as a synthetic failed render; it remains
  represented by accepted input, approval receipts, and session-wire frames.
- `ThreadLoopProfile.recordsTurnReceipts` has been removed. Receipt policy is
  an envelope contract, not a profile flag.
- subagent child turns use the `subagent` session-wire trigger.
- subagent skill activation and delegation prompt construction stay outside the
  generic envelope in `prepareSubagentEntry(...)`.
- Envelope diagnostics stay process-local. The durable diagnostic projection
  for hosted turn envelopes is the existing receipt and transition set:
  `turn_input_recorded`, `turn_render_committed`, `session_turn_transition`,
  approval receipts, and schedule warning receipts. No durable
  envelope-diagnostics event should be added.

## Stable References

- `docs/reference/session-lifecycle.md`
- `docs/reference/runtime-plugins.md`
- `docs/reference/events.md`
- `docs/research/promoted/rfc-hosted-thread-loop-and-unified-recovery-decisions.md`

## Current Implementation Notes

Implemented files:

- `packages/brewva-gateway/src/session/turn-envelope.ts`
- `packages/brewva-gateway/src/session/thread-loop-profiles.ts`
- `packages/brewva-gateway/src/session/thread-loop-types.ts`
- `packages/brewva-gateway/src/session/hosted-thread-loop.ts`
- `packages/brewva-gateway/src/subagents/entry.ts`
- `packages/brewva-runtime/src/contracts/session-wire.ts`
- `packages/brewva-runtime/src/services/session-wire.ts`

Routed entrypoints:

- daemon worker turns in `packages/brewva-gateway/src/session/worker-main.ts`
- host prompt wrapper in
  `packages/brewva-gateway/src/host/run-hosted-prompt-turn.ts`
- CLI print turns in `packages/brewva-cli/src/cli-runtime.ts`
- shell/TUI prompt ports in
  `packages/brewva-cli/src/shell/adapters/ports.ts`
- channel turns in
  `packages/brewva-gateway/src/channels/channel-agent-dispatch.ts`
- subagent orchestrator turns in
  `packages/brewva-gateway/src/subagents/orchestrator.ts`
- detached subagent runner turns in
  `packages/brewva-gateway/src/subagents/runner-main.ts`

Boundary guards:

- `test/quality/gateway/hosted-turn-envelope-boundary.quality.test.ts`
  prevents production gateway and CLI code from calling
  `runHostedThreadLoop(...)` or resolving thread-loop profiles outside the
  envelope.
- the same guard prevents production receipt writers for
  `turn_input_recorded` and `turn_render_committed` outside the envelope.

## Final Architecture Review

The implementation resolves the original asymmetry. The loop body was already
canonical; accepted-turn prelude and terminal epilogue are now canonical too.

The resulting ownership split is:

- entry adapters own transport, queueing, session construction, presentation,
  and transport-specific status policy.
- the hosted turn envelope owns the hosted accepted-turn protocol.
- `HostedThreadLoop` owns attempt streaming, continuation, compaction,
  reasoning-revert resume, approval suspension, recovery decisions, and loop
  diagnostics.
- runtime remains the authority, inspection, maintenance, event durability, and
  session-wire replay owner.

This does not introduce a new session state machine, widen `BrewvaRuntime`, or
move the kernel transaction boundary above single tool calls.

The diagnostic boundary is intentionally boring: process-local diagnostics may
help gateway callers explain a fresh result, but replay and operator forensics
must use the durable receipts and hosted transition history already listed in
the event reference. The envelope is a canonical writer for turn receipts, not
a new diagnostic event family.

## Promoted Contract Checklist

- [x] All production hosted prompt turns enter the canonical envelope.
- [x] Accepted input receipt generation is centralized.
- [x] Terminal render receipt generation is centralized.
- [x] Approval suspension does not create a false failed render.
- [x] Schedule-trigger inheritance runs in the envelope prelude.
- [x] WAL recovery entered/completed/failed transitions run in the envelope.
- [x] Channel dispatch keeps its explicit non-completed adapter policy while
      entering through the envelope.
- [x] CLI and TUI prompt wrappers delegate through the envelope and strip
      process-local diagnostics.
- [x] Subagent child turns enter through the envelope with the `subagent`
      session-wire trigger.
- [x] Subagent entry preparation is shared through
      `prepareSubagentEntry(...)` and remains outside generic envelope logic.
- [x] Production import and receipt-writer boundary tests guard the contract.
- [x] Stable reference docs carry the accepted lifecycle and event semantics.
- [x] Envelope diagnostics durable projection decision is closed: no separate
      durable envelope-diagnostics event; use receipts and transitions.

## Non-Goals

- Rewriting the agent engine.
- Replacing `HostedThreadLoop`.
- Adding a broader session ownership state machine.
- Widening `BrewvaRuntime` authority surfaces.
- Moving the runtime transaction boundary above single tool calls.
- Adding cross-agent saga or compensation semantics.
- Adding a parallel durable envelope diagnostics event family.

## Closed Implementation Posture

This RFC has no remaining implementation backlog. Future work may still split
large internal files if responsibility drift appears, but file splitting is
ordinary maintainability work rather than unfinished envelope architecture.
