# Authored Behavior Patterns

High-quality skills need more than frontmatter contracts.

The contract tells Brewva what a skill is allowed to do and what artifacts it
must emit. The skill body tells the model how a capable specialist should
behave while doing the work. Strong skills need both.

## What To Encode In The Skill Body

Prefer explicit sections for the following behavior:

### Role Posture

State what kind of specialist the skill is acting as and what it should care
about most.

Examples:

- A design skill should optimize for bounded decisions and implementation
  readiness, not abstract architecture theater.
- A review skill should optimize for behavioral risk and merge safety, not code
  style commentary.

### Interaction Protocol

Document when the skill should ask questions, when it should proceed on
reasonable assumptions, and how it should re-ground the user when context may be
stale.

Good interaction rules are:

- ask only when the answer changes correctness or the primary path
- provide one recommended path plus one bounded alternative
- avoid open-ended brainstorming once the task is execution-ready

### Decision Protocol

Explain how the skill should make choices, not just what outputs it should
produce.

Examples:

- compare 1-3 viable approaches, then choose one
- rank hypotheses and falsify the strongest first
- classify findings by severity and decide whether the next action is fix,
  redesign, or block

### Handoff Expectations

Every output should make the next skill easier to run.

Document what downstream consumers must learn from each artifact. A weak output
contract rejects placeholders; a strong handoff section tells the model what the
artifact must contain to be useful.

Examples:

- `design_spec` should expose boundaries, non-goals, affected modules, and the
  chosen path
- `verification_evidence` should preserve commands, diagnostics, and observed
  outcomes so debugging or review can continue without re-deriving context
- `review_findings` should identify condition, impact, evidence, and expected
  next action

### Completion And Escalation

State what counts as done, when to stop, and when to escalate instead of
guessing.

Useful escalation rules include:

- stop when the real problem is a different skill territory
- stop when required evidence is unavailable
- stop when the remaining decision belongs to the user or an approval boundary

## Good Skill Structure

For behavior-rich skills, a practical structure is:

1. Intent
2. Trigger
3. Workflow
4. Interaction Protocol
5. Decision Protocol
6. Handoff Expectations
7. Stop Conditions
8. Anti-Patterns
9. Example

Not every skill needs every section, but core skills should generally have at
least explicit interaction, decision, and handoff guidance.

## What To Avoid

- contract-only skeletons that describe outputs but not working behavior
- giant host-specific preambles inside every skill
- vague instructions such as "be thorough" without a concrete protocol
- duplicating runtime authority in skill prose

## Memory Nudge

When a skill completes work that produces reusable insight, the model should
actively consider whether the lesson belongs in deliberation memory.

Good memory candidates:

- a verification strategy that worked reliably in this repository
- a user preference or collaboration pattern observed across interactions
- a recurring failure mode and its proven fix
- a constraint or convention that was not obvious from code alone

The `deliberation_memory` tool is read-only inspection. Memory artifacts are
derived automatically from durable evidence such as skill completions,
verification outcomes, iteration facts, and task specs. The model does not need
to write memory explicitly. But the model should use `self-improve` or `retro`
to surface lessons worth preserving, because those skill outputs feed the
derivation pipeline.

Do not treat every observation as a systemic lesson. One-off findings stay in
skill outputs; only repeated, evidence-backed patterns earn long-term memory.

## Brewva-Specific Boundary

Absorb authored-behavior patterns aggressively, but keep kernel authority in the
runtime:

- skills may suggest next actions, but they do not create a runtime-owned stage
  machine
- skills may describe approval-sensitive choices, but `effect_commitment`
  remains the proposal boundary
- skills should improve specialist behavior without reintroducing hidden control
  loops
