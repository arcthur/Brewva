---
name: goal-loop
description: Use bounded multi-run continuity when progress must span repeated executions
  and convergence can be judged from explicit evidence.
stability: experimental
intent:
  outputs:
    - loop_contract
    - iteration_report
    - convergence_report
    - continuation_plan
  output_contracts:
    loop_contract:
      kind: text
      min_words: 3
      min_length: 18
    iteration_report:
      kind: text
      min_words: 3
      min_length: 18
    convergence_report:
      kind: text
      min_words: 2
      min_length: 12
    continuation_plan:
      kind: json
      min_items: 1
effects:
  allowed_effects:
    - workspace_read
    - runtime_observe
    - schedule_mutation
resources:
  default_lease:
    max_tool_calls: 70
    max_tokens: 140000
  hard_ceiling:
    max_tool_calls: 110
    max_tokens: 200000
execution_hints:
  preferred_tools:
    - read
  fallback_tools:
    - schedule_intent
    - task_view_state
    - ledger_query
    - skill_chain_control
    - skill_complete
references:
  - skills/meta/skill-authoring/references/authored-behavior.md
  - references/convergence-patterns.md
  - references/handoff-patterns.md
consumes:
  - design_spec
  - execution_plan
  - verification_evidence
requires: []
---

# Goal Loop Skill

## Intent

Represent cross-run continuity explicitly instead of pretending one interactive session can safely absorb long-running work.

## Trigger

Use this skill when:

- the user asks to continue work over time
- repeated execution is required to converge
- runtime-managed continuity is preferable to one long session

## Workflow

### Step 1: Prove loop viability

Confirm the goal, convergence signals, cadence, and exit path are explicit.

### Step 2: Encode the loop contract

Produce:

- `loop_contract`: goal, cadence, max runs, recovery path
- `continuation_plan`: what each run should attempt

### Step 3: Emit run-level evidence

On each pass, produce:

- `iteration_report`: slice attempted, evidence, status
- `convergence_report`: converged, blocked, or max-runs reached

### Step 4: Decide ownership of the next move

Explicitly decide whether the next move remains in `goal-loop` or should be
handed to design, implementation, debugging, runtime-forensics, or a runtime
verification/scheduling path.

## Interaction Protocol

- Ask only when the user has not defined the objective, cadence, convergence
  signal, or termination rule well enough to make the loop safe.
- Re-ground every loop proposal in concrete observables: what each run will try,
  what evidence counts as progress, and what condition ends the loop.
- Do not sell continuity as magic persistence. Explain what the runtime will
  observe and why repeated execution is justified.

## Convergence Protocol

- Use explicit, observable convergence predicates. If no predicate exists, stop
  and route back to design.
- Treat `maxRuns` as a safety rail, not the business definition of done.
- Prefer loops only when the work truly spans multiple bounded runs. If one
  normal execution can finish the task, do not create a loop.
- Each run must either narrow uncertainty, advance the objective, or produce a
  better handoff packet. If it does none of these, the loop is not converging.

## Handoff Expectations

- `loop_contract` should name the goal, cadence, convergence condition, run
  limit, and recovery path so later runs do not reinterpret the loop.
- `continuation_plan` should define what the next run attempts, what evidence it
  must gather, and what owner takes over if that run fails.
- `iteration_report` should capture the objective slice attempted, evidence
  observed, and whether the run changed the convergence state.
- `convergence_report` should say one of three things clearly: converged,
  blocked with reason, or still active with the next narrowing step.

## Exit And Ownership Protocol

- Stay in `goal-loop` only while it is coordinating bounded continuity.
- Hand off to `design` when the contract or success definition is unclear.
- Hand off to `implementation` when the next run is straightforward execution
  work.
- Hand off to `debugging` or `runtime-forensics` when failure evidence, not loop
  coordination, is the primary problem.
- Return to `goal-loop` only when a new plan, new evidence, or a narrower next
  action justifies another run.

## Stop Conditions

- the task should finish in one normal execution pass
- convergence cannot be defined from observable runtime signals
- the real work is still design or implementation, not continuity

## Anti-Patterns

- routing ordinary complex implementation here by default
- writing "keep trying until done" with no explicit convergence logic
- using continuity as a substitute for clear delivery boundaries
- bouncing ownership between skills without new evidence or a changed plan

## Example

Input: "Keep shipping the migration work over the next few days and stop when the P0 checklist is fully verified."

Output: `loop_contract`, `iteration_report`, `convergence_report`, `continuation_plan`.
