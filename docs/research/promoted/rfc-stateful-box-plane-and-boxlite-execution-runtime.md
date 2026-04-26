# Research: Stateful Box Plane And BoxLite Execution Runtime

## Document Metadata

- Status: `promoted`
- Owner: runtime, tools, and distribution maintainers
- Last reviewed: `2026-04-26`
- Promotion target:
  - `docs/architecture/invariants-and-reliability.md`
  - `docs/architecture/system-architecture.md`
  - `docs/reference/configuration.md`
  - `docs/reference/events.md`
  - `docs/reference/exec-threat-model.md`
  - `docs/reference/runtime.md`
  - `docs/reference/tools.md`
  - `docs/solutions/security/exec-command-policy-and-readonly-shell.md`
  - `docs/research/promoted/rfc-action-policy-registry-and-least-privilege-governance.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- Brewva's default isolated execution backend is the stateful BoxLite-backed box
  plane, not one-command microsandbox routing.
- `@brewva/brewva-box` owns box acquisition, execution, detached observation,
  snapshot, fork, release, inventory, and maintenance semantics.
- `exec` remains the shell-command adapter and result boundary. It delegates
  isolated execution to the box plane instead of owning sandbox lifecycle.
- `security.execution.backend="box"` is the default isolated route. Explicit
  host execution remains available outside strict mode and never happens through
  automatic fallback.
- Removed sandbox-era fields fail fast:
  `security.execution.sandbox.*`, `backend="sandbox"`,
  `backend="best_available"`, `fallbackToHost`,
  `security.credentials.sandboxApiKeyRef`, and `MSB_SERVER_URL`.
- Box state is operational substrate state, not replay authority. Event tape,
  receipts, and WAL/recovery records remain authoritative; DuckDB session index
  state remains rebuildable.
- `local_exec_readonly` stays an exploration route through command-policy
  acceptance and `virtual_readonly`; verification claims still require real box
  execution or explicit host execution.
- Distribution targets are limited to BoxLite-supported native targets:
  `darwin-arm64`, `linux-x64` glibc, and `linux-arm64` glibc.

## Stable References

- `docs/architecture/invariants-and-reliability.md`
- `docs/architecture/system-architecture.md`
- `docs/reference/configuration.md`
- `docs/reference/events.md`
- `docs/reference/exec-threat-model.md`
- `docs/reference/runtime.md`
- `docs/reference/tools.md`
- `docs/solutions/security/exec-command-policy-and-readonly-shell.md`
- `docs/research/promoted/rfc-action-policy-registry-and-least-privilege-governance.md`

## Stable Contract Summary

The promoted contract is:

1. Boxes are first-class execution workbenches.
   A scoped box preserves useful filesystem and process state across an agent's
   work instead of recreating a sandbox for every command.
2. Box state is explicit but non-authoritative.
   Brewva may inspect, reconcile, snapshot, and release boxes, but durable truth
   stays in the event tape, receipts, Recovery WAL, and replayable runtime
   records.
3. Execution routing is fail-closed.
   If the selected box route cannot run, Brewva reports the isolated execution
   failure. It does not silently fall back to host execution.
4. Configuration names match the current primitive.
   The public surface says `box`; retired `sandbox` and remote-service fields
   are rejected instead of kept as compatibility aliases.
5. BoxLite is quarantined behind the box plane package.
   Runtime, tools, and distribution code consume Brewva's `BoxPlane` contract,
   not raw BoxLite SDK shapes.
6. Native packaging policy is product-visible.
   Unsupported native targets stay unpublished or non-interactive until
   BoxLite-compatible native bindings exist.

## Current Implementation Notes

- `packages/brewva-box/src/index.ts` exports the Brewva `BoxPlane` contract and
  constructs the BoxLite-backed implementation.
- `packages/brewva-box/src/boxlite/plane.ts` owns BoxLite acquisition,
  execution, detached observation, snapshots, forks, release, inventory, and
  maintenance.
- `packages/brewva-tools/src/box-plane-runtime.ts` binds runtime security
  config to the box plane.
- `packages/brewva-tools/src/exec.ts` routes isolated command execution through
  scoped boxes and keeps `virtual_readonly` separate from real verification
  execution.
- `packages/brewva-runtime/src/config/defaults.ts` defaults execution to
  `backend: "box"`.
- `packages/brewva-runtime/src/config/field-policy.ts` and
  `packages/brewva-runtime/src/config/normalize-security.ts` reject removed
  sandbox-era fields and unsupported box settings.
- `script/build-binaries.ts`, `script/verify-dist.ts`, and CLI packaging tests
  keep native distribution targets aligned with BoxLite support.
- `docs/reference/configuration.md`, `docs/reference/exec-threat-model.md`,
  `docs/reference/events.md`, and `docs/reference/tools.md` carry the stable
  user-facing execution contract.

## Validation Status

Promotion is backed by existing unit, contract, system, live, docs, and
distribution coverage for:

- stateful box configuration defaults and removed sandbox-field rejection
- scoped box execution, detached observation, snapshots, forks, and maintenance
- `exec` routing through boxes and `virtual_readonly`
- command-policy and read-only shell behavior
- supported native binary targets and staged BoxLite bindings
- stable reference docs and research index consistency

Current verification entrypoints include:

- `bun run check`
- `bun test`
- `bun run test:docs`
- `bun run format:docs:check`
- `bun run test:dist`
- `bun run test:live:boxlite` when a BoxLite-capable live environment is
  available

## Remaining Backlog

The following areas are intentionally outside the promoted v1 contract:

- changing the default session-box lifetime from `session` to `forever`
- adding an explicit model-facing `box_snapshot` managed tool
- direct BoxLite secret injection before the SDK contract can carry it safely
- non-empty box network allowlists before the adapter can enforce them
  fail-closed
- publishing native targets beyond current BoxLite support

If any of those areas need expansion, start a new focused RFC rather than
widening this promoted pointer back into a mixed proposal.

## Historical Notes

- The pre-promotion RFC compared the old microsandbox route, BoxLite
  integration options, configuration migration, packaging changes, and rollout
  gates while implementation was in flight.
- Historical migration rationale is summarized in
  `docs/research/archive/rfc-stateful-box-plane-and-boxlite-execution-runtime.md`.
- Full proposal detail should be recovered from git history, not carried in the
  promoted status pointer.
