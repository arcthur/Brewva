# Bounded Optimization Protocol Reference

Load this reference when `goal-loop` is coordinating a bounded optimization run
that depends on repeated execution, explicit cadence, and objective iteration
facts.

## Core Cycle

Each iteration follows one path:

```text
review lineage state -> pick one causal unit -> apply -> measure -> guard -> decide -> record -> next
```

The important constraint is "one causal unit", not "one edited line". The
iteration should remain small enough that the recorded outcome is still
explainable.

## Identity And Memory

The loop has three durable identifiers:

- `loop_key`
- `run_key`
- `iteration_key`

Recommended shape:

```text
run_key = "<loop_key>/run-N"
iteration_key = "<run_key>/iter-N"
baseline iteration_key = "<loop_key>/run-1/baseline"
```

All facts use:

```text
source = "goal-loop:<loop_key>"
```

This is what makes lineage-scoped history queryable without inventing planner
state.

## Preflight Discipline

Do not start the loop until all of these are true:

1. scope resolves
2. cadence is explicit
3. metric is mechanical
4. guard is runnable
5. convergence is observable
6. escalation path is concrete
7. baseline fact is recorded

If any item fails, route back to `design` or stop and ask the user.

## Decision Discipline

Use objective evidence only:

```text
IF metric improved AND delta > min_delta AND (no guard OR guard passed):
    decision = "keep"
ELIF metric improved AND guard failed:
    decision = "discard"
    reasonCode = "guard_regression"
ELIF metric improved AND delta <= min_delta:
    decision = "discard"
    reasonCode = "below_noise_floor"
ELIF metric unchanged or worse:
    decision = "discard"
    reasonCode = "no_improvement"
ELIF execution crashed:
    decision = "crash"
    reasonCode = "<error classification>"
```

Do not decide based on taste, optimism, or "this probably helped".

## Noise Handling

If the metric is noisy:

1. run the measurement multiple times
2. use an aggregation such as `median`, `p95`, or `avg`
3. define `min_delta`
4. treat improvements below `min_delta` as noise

Fast verification matters. The loop should use the cheapest measurement that
still preserves the real signal.

## Guard Recovery

When the metric improves but the guard fails:

1. discard the change
2. record `reasonCode = "guard_regression"`
3. inspect the guard output
4. try a different approach to the same objective slice

Do not quietly keep the change and hope to fix the guard later inside the same
record.

## Lineage-Aware History Lookup

Scheduled inherited runs happen in child sessions. Therefore:

- current-session history is not enough
- cross-run history must be queried with `session_scope = parent_lineage`
- loop history must be narrowed with `source = "goal-loop:<loop_key>"`

This is how the protocol avoids mixing:

- unrelated loops in the same session
- inherited child sessions from different loops
- detached `fresh` child sessions

## Stuck Escalation

A discard streak is a protocol signal, not a runtime-owned planner state.

Suggested default:

- if the last 5 iterations are all `discard`, treat the loop as stuck

When stuck:

1. re-read all in-scope files
2. inspect lineage-scoped metric and decision history
3. identify what keeps failing
4. change strategy once
5. if the next iteration still fails, emit `convergence_reason` with
   `status = "escalated"`

The escalation owner must already exist in the loop contract.

## Continuity Reminder

`goal-loop` is not only about optimization. It also owns bounded continuity:

- whether another run should happen
- when the next run should happen
- whether that run is immediate, manual, or scheduler-backed

If the protocol cannot say when the next run happens, it has not finished its
job.
