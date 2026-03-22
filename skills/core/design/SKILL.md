---
name: design
description: Turn a request into a bounded design and executable plan, choosing the
  right implementation mode without over-designing trivial work.
stability: stable
intent:
  outputs:
    - design_spec
    - execution_plan
    - execution_mode_hint
    - risk_register
  output_contracts:
    design_spec:
      kind: text
      min_words: 4
      min_length: 24
    execution_plan:
      kind: json
      min_items: 2
    execution_mode_hint:
      kind: enum
      values:
        - direct_patch
        - test_first
        - coordinated_rollout
    risk_register:
      kind: json
      min_items: 1
effects:
  allowed_effects:
    - workspace_read
    - runtime_observe
  denied_effects:
    - workspace_write
    - local_exec
resources:
  default_lease:
    max_tool_calls: 90
    max_tokens: 180000
  hard_ceiling:
    max_tool_calls: 130
    max_tokens: 240000
execution_hints:
  preferred_tools:
    - read
    - grep
  fallback_tools:
    - glob
    - lsp_symbols
    - lsp_find_references
    - ledger_query
    - skill_complete
references:
  - skills/meta/skill-authoring/references/authored-behavior.md
  - references/executable-evidence-bridge.md
  - references/oracle-consultation-protocol.md
  - references/plan-output-template.md
consumes:
  - problem_frame
  - user_pains
  - scope_recommendation
  - design_seed
  - open_questions
  - strategy_review
  - scope_decision
  - strategic_risks
  - repository_snapshot
  - impact_map
  - root_cause
  - runtime_trace
requires: []
---

# Design Skill

## Intent

Choose the minimum correct solution shape and turn it into an execution-ready plan.

## Trigger

Use this skill when:

- the task has multiple viable approaches
- a change crosses package or module boundaries
- implementation mode is not obvious

## Workflow

### Step 1: Challenge scope

Determine whether the request is a trivial local change or a real design problem.

### Step 2: Compare approaches

Offer 1-3 materially different approaches with trade-offs, then choose one.

### Step 3: Force the key decisions into the open

Make boundary ownership, migration posture, verification posture, and rollback
assumptions explicit before emitting the final plan.

### Step 4: Emit bounded artifacts

Produce:

- `design_spec`: objective, boundaries, and chosen approach
- `execution_plan`: ordered steps and verification intent
- `execution_mode_hint`: `direct_patch`, `test_first`, or `coordinated_rollout`
- `risk_register`: concrete risks and mitigations

## Interaction Protocol

- Ask questions only when the answer changes the primary architecture choice,
  effect boundary, or acceptance criteria.
- If context may be stale, briefly re-ground the request in current repository
  reality before recommending a path.
- When user input is needed, recommend one primary path and one bounded
  alternative instead of presenting an open menu of possibilities.

## Decision Protocol

- Start with at most three viable approaches.
- Compare them on boundary ownership, blast radius, migration or rollback cost,
  verification strength, and operational risk.
- Choose one path explicitly. Do not leave the main design undecided unless the
  missing choice genuinely belongs to the user.
- Prefer complete but bounded work over shortcut plans that defer obvious edge
  cases into follow-up churn.

## Handoff Expectations

- `design_spec` should tell implementation what is changing, what is not
  changing, which modules own the work, and which constraints are non-negotiable.
- `execution_plan` should be ordered, concrete, and verification-aware so the
  implementation skill can execute without redesigning the task.
- `execution_mode_hint` should be evidence-based. Use `direct_patch` only for
  truly local work, `test_first` when behavior needs pinning, and
  `coordinated_rollout` when change spans multiple boundaries.
- `risk_register` should be ranked by likely impact and should name the signals
  that review or verification must watch later.

## Stop Conditions

- a critical requirement is missing and changes the primary architecture choice
- all viable options violate hard constraints
- the real blocker is lack of repository understanding

## Anti-Patterns

- forcing design on an obvious one-file fix
- skipping trade-offs and presenting one option as inevitable
- producing a plan that is not tied to real files or modules
- emitting generic architecture prose that does not help the next skill act

## Example

Input: "Refactor skill routing to add profile-aware filtering without weakening runtime governance."

Output: `design_spec`, `execution_plan`, `execution_mode_hint`, `risk_register`.
