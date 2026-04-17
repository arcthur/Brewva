# Research: Runtime-Owned Session Lifecycle Aggregate And Authority Gate

## Document Metadata

- Status: `promoted`
- Owner: runtime and gateway maintainers
- Last reviewed: `2026-04-17`
- Promotion target:
  - `docs/architecture/system-architecture.md`
  - `docs/reference/runtime.md`
  - `docs/reference/session-lifecycle.md`
  - `docs/reference/events.md`
  - `docs/reference/gateway-control-plane-protocol.md`

## Promotion Summary

This note is now a short status pointer.

The promoted decision is:

- Brewva keeps federated domain reducers and hydration folds; it does not
  replace them with one monolithic lifecycle reducer
- runtime owns aggregate lifecycle meaning through
  `inspect.lifecycle.getSnapshot(sessionId)` and the exported
  `SessionLifecycleSnapshot` contract
- production lifecycle projection composes hydrated domain reducers plus
  recovery posture, approval state, open tool calls, hosted transition
  provenance, and runtime-owned session-wire facts
- lifecycle summary precedence is runtime-owned and shared:
  `cold | active | idle | blocked | recovering | degraded | closed`
- gateway and host products consume lifecycle as adapters rather than
  re-inventing parallel durable semantics
- lifecycle-bearing write paths are hardened through transition gating,
  reconciliation validation, and canonical terminal shutdown receipts rather
  than late defensive interpretation

Stable references:

- `docs/architecture/system-architecture.md`
- `docs/reference/runtime.md`
- `docs/reference/session-lifecycle.md`
- `docs/reference/events.md`
- `docs/reference/gateway-control-plane-protocol.md`

## Stable Contract Summary

The promoted contract is:

1. Runtime owns aggregate lifecycle meaning.
   Tape, receipts, and Recovery WAL remain authority. Lifecycle snapshot is the
   runtime-owned read model that composes that authority into one posture.
2. Domain reducers stay federated.
   Hydration folds, approval hydration, recovery posture, hosted transitions,
   and tooling state continue to own their local rebuild logic.
3. Session lifecycle is multi-axis, not flat.
   `hydration`, `execution`, `recovery`, `skill`, `approval`, `tooling`,
   `integrity`, and `summary` remain distinct surfaces.
4. Adapters consume lifecycle; they do not define it.
   Gateway `session.status`, provider-request recovery policy, and host
   bootstrap/reconciliation read lifecycle first and only keep bounded
   compatibility fallbacks where necessary.
5. Host `SessionPhase` remains local.
   It stays a controller FSM for interaction and UI orchestration, not the
   authoritative meaning of durable runtime lifecycle.
6. Write-side hardening is narrow and lifecycle-specific.
   The promoted design hardens lifecycle-bearing write paths without widening
   business-domain authority into one giant service.

## Validation Status

Promotion is backed by:

- stable exported runtime contracts for `SessionLifecycleSnapshot` and
  `inspect.lifecycle.getSnapshot(sessionId)`
- runtime aggregate projection composed from hydrated state and replay-owned
  lifecycle helpers
- host bootstrap and reconciliation coverage consuming lifecycle snapshot while
  preserving compatibility diagnostics for incompatible representable deltas
- gateway adapter migration on primary paths including session-status seeding,
  provider-request reduction posture checks, and recovery-entry helpers
- canonical terminal shutdown receipts and transition gating coverage on the
  worker, orchestration, and hosted transition paths
- repository verification via `bun run check`, `bun test`,
  `bun run test:docs`, and `bun run format:docs:check`

## Source Anchors

- `packages/brewva-runtime/src/contracts/session-lifecycle.ts`
- `packages/brewva-runtime/src/lifecycle/session-lifecycle-snapshot.ts`
- `packages/brewva-runtime/src/runtime.ts`
- `packages/brewva-runtime/src/recovery/read-model.ts`
- `packages/brewva-gateway/src/host/managed-agent-session.ts`
- `packages/brewva-gateway/src/daemon/session-wire-status.ts`
- `packages/brewva-gateway/src/runtime-plugins/provider-request-reduction.ts`
- `packages/brewva-gateway/src/session/reasoning-revert-recovery.ts`
- `packages/brewva-gateway/src/session/turn-transition.ts`
- `packages/brewva-gateway/src/session/worker-main.ts`
- `packages/brewva-gateway/src/session/shutdown-receipts.ts`

## Remaining Backlog

The following areas remain intentionally outside the promoted core:

- whether lifecycle subscription should become a first-class public runtime
  surface rather than remaining behind existing live event/session-wire paths
- how far remaining compatibility fallback reducers should be thinned once the
  aggregate fully covers their bootstrap and replay needs
- whether `RuntimeSessionStateCell` should be further reduced once more
  lifecycle-bearing hot-path fields become pure cache
- whether future lifecycle-bearing families justify additional hard validation
  surfaces beyond the current transition and terminal-receipt hardening

If those areas need expansion, they should start from a new focused RFC rather
than reopening this promoted status pointer as a mixed design-and-rollout note.

## Historical Notes

- The original active RFC still contained unresolved option analysis and a
  larger illustrative schema. Those details were removed after implementation
  settled on the current exported contract.
- Stable lifecycle semantics now live in reference and architecture docs plus
  regression coverage, not in `docs/research/active/`.
