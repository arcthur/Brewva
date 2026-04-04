# Research: Authority-Surface Narrowing And Runtime-Facade Compression

## Document Metadata

- Status: `promoted`
- Owner: runtime maintainers
- Last reviewed: `2026-04-04`
- Promotion target:
  - `docs/architecture/design-axioms.md`
  - `docs/architecture/system-architecture.md`
  - `docs/reference/runtime.md`

## Problem Statement And Scope

Promotion note:

- the stable runtime contract is now the semantic-root-surface model documented
  in `docs/architecture/system-architecture.md` and
  `docs/reference/runtime.md`
- examples below may refer to the pre-compression `runtime.<domain>.*`
  vocabulary when describing the pressure that motivated the change

`Brewva` already distinguishes several important categories more clearly than
most agent harnesses:

- kernel authority
- replay truth
- rebuildable state
- operator-facing inspection

That is a strength. It is better than collapsing all runtime behavior into one
flat execution loop, and better than reducing runtime to a single admission
gate followed by blind execution.

However, the public narrative still has a serious weakness:

- `packages/brewva-runtime/src/runtime.ts` exposes a broad `BrewvaRuntime`
  domain facade
- `docs/reference/runtime.md` largely describes that surface domain by domain
- readers can therefore misread `public` as `equally authoritative`
- hosts, plugins, skills, and operator products can then couple too early to
  mechanism-heavy surfaces such as ledger access, `turnWal`, or
  projection/context plumbing

That creates three problems:

1. learning cost grows with runtime mechanism width rather than authority
   complexity
2. surrounding product layers can mistake explicit inspection and recovery
   mechanisms for default business semantics
3. future subtraction becomes harder because too many integrations depend on
   the wrong layer

This RFC does not aim to weaken the kernel, and it does not aim to hide
durability or rollback behind vague abstractions.

Its goal is to:

- keep authority, replay, and rollback boundaries explicit where they must be
- narrow the default interpretation surface and the default coupling surface
- make stable docs clearly distinguish:
  - `authority-facing contract`
  - `operator / inspection surface`
  - `rebuild / maintenance surface`

Out of scope:

- removing `effect_commitment`, receipts, exact resume, WAL, ledger, or
  verification
- rewriting runtime into a planner-shaped orchestration loop
- labeling crash recovery or rollback contracts as “mere implementation detail”
- large one-shot redesign of the current public API

## Direct Conclusion

Adopt the following direction:

1. Keep hard-explicit boundaries where they are required
   - boundary classification
   - the `effect_commitment` proposal / approval / resume protocol
   - receipt-bearing outcomes
   - replay truth and integrity
   - rollback identity
   - verification sufficiency
2. Reinterpret the rest of the public surface through explicit tiers
   - operator / inspection surface
   - rebuild / maintenance surface
3. Make hosts, plugins, skills, and future SDKs couple to the narrowest
   correct layer by default
   - not “any public method is fair game”
   - but “which layer is actually needed for authority, replay, or operator
     recovery?”
4. Narrow documentation first, then compress the facade gradually in code

Short version:

`public width is not authority width`

## Why This Direction

### 1. Explicitness should optimize for correctness, not conceptual completeness

`Brewva` is valuable not because it has many concepts, but because it turns the
hardest-to-reverse, easiest-to-dispute, and most crash-sensitive boundaries
into protocols:

- `safe` / `effectful` boundary classification
- `effect_commitment`
- durable receipts
- exact approved resume
- rollback artifacts
- replay-derived integrity

If those boundaries are not explicit, later runtime flexibility becomes
argument rather than design.

By contrast, ledger access, `turnWal`, projection, skill refresh, and context
pressure are all still important, but they do not all deserve to be first-line
semantic concepts for every contributor or integration.

### 2. A public surface that is too wide makes mechanism look like contract

The current public runtime surface mixes three things:

- commitment authority
- explicit inspection products
- rebuild and maintenance helpers

If stable docs do not separate those categories first, readers will reach the
wrong conclusions:

- “`runtime.turnWal.*` is public, so WAL must be my product integration layer”
- “`runtime.ledger.*` is public, so ledger rows are the default product
  semantics”
- “`runtime.context.*` is broad, so context plumbing must be the default
  extension entrypoint”

That kind of coupling is convenient in the short term and expensive in the long
term.

### 3. The next subtraction is not about deleting mechanisms; it is about deleting default dependency assumptions

This subtraction is not:

- remove WAL
- remove ledger
- remove projection

It is:

- stop treating those mechanism layers as the default product vocabulary
- stop describing every public domain as equally kernel-central
- stop adding public APIs without first stating which surface tier they belong
  to

### 4. `Brewva` only earns its position if authority width stays smaller than runtime width

If `Brewva` cannot explain this relationship clearly, it degrades into a
system with many concepts and an unclear center of gravity.

If it can prove that:

- authority surface can remain narrow
- operator and recovery surfaces can remain rich
- the line between them stays legible

then it becomes meaningfully different from:

- `Codex` as a contract-first gate
- `Claude Code` as a runtime-first loop

## Current Pressure Points

### Pressure 1: `BrewvaRuntime` facade width is too close to internal organization width

`BrewvaRuntime` currently exposes:

- `runtime.proposals.*`
- `runtime.context.*`
- `runtime.tools.*`
- `runtime.task.*`
- `runtime.truth.*`
- `runtime.ledger.*`
- `runtime.schedule.*`
- `runtime.turnWal.*`
- `runtime.events.*`
- `runtime.verification.*`
- `runtime.cost.*`
- `runtime.session.*`

That is convenient for implementation and testing, but it is not inherently
safe as an architectural narrative.

### Pressure 2: stable docs already define durability taxonomy, but not public coupling taxonomy

Current architecture docs are already clear about:

- what counts as `durable source of truth`
- what counts as `durable transient`
- what counts as `rebuildable state`
- what counts as `cache`

But they do not yet answer with the same clarity:

- which public surfaces define the default authority contract
- which public surfaces are operator inspection only
- which public surfaces are rebuild and maintenance helpers

### Pressure 3: explicit inspection and recovery surfaces are easily misread as recommended dependency surfaces

It is correct for `Brewva` to keep recovery, undo, integrity, turn WAL, and
ledger inspection explicit and inspectable.

The problem is not that they are public. The problem is that the docs do not
yet say clearly enough:

`public does not mean default coupling target`

## Proposed Model

Surface tiers are classified at the method or method-group level, not at the
namespace level.

A single `runtime.<domain>` namespace may contain methods across multiple
tiers. The purpose of the tier model is to narrow interpretation and coupling,
not to pretend every namespace is internally uniform.

### Tier 1: Authority-Facing Contract

This tier answers:

`What changes the system's commitments to the world, or changes replay truth?`

Stable core semantics should include:

- proposal admission
- effect authorization
- approval-bearing exact resume
- durable linked tool outcomes
- verification sufficiency
- rollback identity
- task, truth, and schedule commitment semantics

Typical public examples:

- `runtime.proposals.submit(...)`
- `runtime.proposals.decideEffectCommitment(...)`
- `runtime.tools.start(...)`
- `runtime.tools.finish(...)`
- `runtime.tools.recordResult(...)`
- `runtime.schedule.createIntent(...)`
- `runtime.schedule.updateIntent(...)`
- `runtime.schedule.cancelIntent(...)`
- `runtime.task.setSpec(...)`
- `runtime.task.addItem(...)`
- `runtime.task.updateItem(...)`
- `runtime.task.recordBlocker(...)`
- `runtime.task.recordAcceptance(...)`
- `runtime.task.resolveBlocker(...)`
- `runtime.truth.upsertFact(...)`
- `runtime.truth.resolveFact(...)`
- `runtime.cost.recordAssistantUsage(...)`
- `runtime.tools.rollbackLastMutation(...)`
- `runtime.verification.*`

### Tier 2: Operator / Inspection Surface

This tier answers:

`How do operators see, query, and explain existing authority or runtime behavior?`

This layer can remain rich and explicit, but it should not be the default
coupling target for extensions.

Typical public examples:

- `runtime.events.query(...)`
- `runtime.events.queryStructured(...)`
- `runtime.events.list(...)`
- `runtime.events.searchTape(...)`
- `runtime.ledger.*`
- `runtime.cost.getSummary(...)`
- `runtime.session.*` integrity, hydration, and replay inspection
- `runtime.schedule.listIntents(...)`
- `runtime.schedule.getProjectionSnapshot(...)`
- `runtime.tools.checkAccess(...)`
- `runtime.tools.explainAccess(...)`
- `runtime.proposals.list(...)`
- `runtime.proposals.listEffectCommitmentRequests(...)`
- `runtime.proposals.listPendingEffectCommitments(...)`

### Tier 3: Rebuild / Maintenance Surface

This tier answers:

`How does the system refresh, rebuild, or replenish working state and crash-recovery material?`

These surfaces are public mainly for:

- operator flow
- host lifecycle
- bounded recovery
- explicit maintenance

They are not public because they should automatically become the semantic core
of every product surface.

Typical public examples:

- `runtime.context.onTurnStart(...)`
- `runtime.context.onTurnEnd(...)`
- `runtime.context.observeUsage(...)`
- `runtime.context.buildInjection(...)`
- `runtime.context.requestCompaction(...)`
- `runtime.context.markCompacted(...)`
- `runtime.skills.refresh(...)`
- `runtime.turnWal.*`
- `runtime.events.record(...)`
- `runtime.events.recordMetricObservation(...)`
- `runtime.events.recordGuardResult(...)`
- `runtime.events.recordTapeHandoff(...)`

Important note:

- `runtime.events.record(...)` is a raw maintenance escape hatch
- it writes directly to the tape-shaped runtime event surface
- it is not a default product integration contract
- callers should prefer narrower authority-facing APIs or explicit read models
  whenever those exist

## Public-Surface Rules

Future stable docs and public API design should follow these rules.

### Rule 1: Every new public API should declare its surface tier first

Minimum requirement:

- whether it is authority-facing
- if not, why it still needs to be public
- who the default caller is

### Rule 2: Prefer a narrower read model before exposing a raw mechanism layer

Preferred order:

1. authority contract
2. explicit read model / operator view
3. raw maintenance mechanism

not the reverse.

### Rule 3: `public` does not automatically mean `kernel-central`

If a surface mainly serves:

- replay diagnostics
- operator troubleshooting
- bounded maintenance
- explicit refresh or rebuild

then the docs should say that explicitly in the opening description.

### Rule 4: Rich inspection is allowed; accidental semantic widening is not

Allowed:

- WAL inspection
- ledger inspection
- explicit projection or context rebuild helpers
- integrity diagnostics

Not allowed:

- treating a visible mechanism as the default product contract
- requiring every integration to understand a domain just because it is public

### Rule 5: Tier 2 surfaces are read-only

Tier 2 is the inspection layer.

If an API:

- writes tape
- mutates session state
- mutates runtime-owned registries
- or changes later admission state

then it is not Tier 2.

It belongs to Tier 1 or Tier 3.

## Recommended Documentation Changes

### 1. `docs/architecture/design-axioms.md`

Add a stable interpretation rule:

- public surface width is not authority width
- runtime may expose inspection and recovery helpers explicitly
- but the default contract should compress toward the smallest
  authority-facing layer

### 2. `docs/architecture/system-architecture.md`

Add a stable section that says:

- public runtime surface should be interpreted in tiers
- a wide facade must not be read as a wide authority contract
- that width is not an architectural endorsement of broad default coupling

### 3. `docs/reference/runtime.md`

Before listing public domain APIs, explain:

- which surfaces are closest to authority contract
- which are operator / inspection
- which are rebuild / maintenance

That way the reader gets an interpretation frame before reading a long list of
domains and methods.

## Implementation Path

Use a gradual `docs-first, code-second` path.

### Phase 1: Narrow the stable documentation first

- add tier interpretation to architecture docs
- mark surface roles at the top of runtime reference docs
- stop writing new RFCs as if “public = equally central”

### Phase 2: Add surface-tier discipline to code-facing API design

For future public methods:

- mark the tier in doc comments or reference docs
- prefer a read model before exposing a raw durability mechanism

### Phase 3: Compress the facade opportunistically

In later refactors, move gradually toward:

- host-facing code preferring narrower contract layers
- operator products accessing recovery material through explicit inspection
  surfaces
- keeping domains public when necessary, while reducing their default semantic
  weight in the docs

Important:

This does not require a one-shot split of `BrewvaRuntime`.
First fix interpretation and new-API discipline. Then decide whether narrower
sub-facades are needed.

## Options Considered

### Option A: Keep the current shape and accept the concept weight

Pros:

- zero migration cost
- no stable-doc updates required

Cons:

- learning cost keeps scaling with mechanism width
- broad accidental coupling continues
- the second subtraction becomes harder over time

### Option B: Split the runtime into multiple public sub-facades immediately

Pros:

- structurally clean
- least room for misreading

Cons:

- higher short-term risk
- too much host and call-site churn at once
- docs would still be missing the interpretation frame first

### Option C: Documentation first, new tier discipline, opportunistic facade compression

Pros:

- lowest risk
- fixes the architectural narrative first
- creates room for later code compression

Cons:

- the public facade remains broad in the short term
- requires sustained discipline to avoid backsliding

Conclusion:

Choose `Option C`.

## Source Anchors

- `packages/brewva-runtime/src/runtime.ts`
- `packages/brewva-runtime/src/services/tool-gate.ts`
- `packages/brewva-runtime/src/services/effect-commitment-desk.ts`
- `packages/brewva-runtime/src/channels/recovery-wal.ts`
- `docs/architecture/design-axioms.md`
- `docs/architecture/system-architecture.md`
- `docs/reference/runtime.md`
- `docs/reference/proposal-boundary.md`
- `docs/reference/session-lifecycle.md`

## Validation Signals

The direction is working when we see:

1. architecture and reference wording no longer treating every public domain as
   the same kind of authority layer
2. every newly added public runtime method in a PR is documented with an
   explicit surface-tier label or method-group tier mapping
3. host, plugin, and operator flows depending less often on `turnWal`, ledger
   rows, or projection internals during design review
4. effect commitment, receipts, verification, rollback, and integrity
   remaining strongly explicit rather than being accidentally removed in the
   name of subtraction

## Promotion Criteria And Destination Docs

Promote this RFC when:

1. `docs/architecture/design-axioms.md` contains the stable
   “public width is not authority width” rule
2. `docs/architecture/system-architecture.md` contains stable public-surface
   tiering language
3. `docs/reference/runtime.md` provides the interpretation frame before the
   runtime API listings
4. new public runtime APIs default to documented tier explanation
5. at least one later code or host refactor demonstrates both:
   - rich inspection surfaces remain available
   - the default coupling surface becomes narrower

Until then, this RFC remains an active note guiding documentation and API
design.
