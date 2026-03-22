# QA Exploratory Regression Checklist

Use this reference when `qa` needs a practical, high-signal pass instead of a
large generic test matrix.

## Core Questions

- What changed in the diff, and which risky user path does that point to first?
- Is the starting state clean enough that a failure means something real?
- Which changed path is most likely to break real user behavior?
- What is the smallest end-to-end flow that proves the change actually works?
- What evidence would make release confidence credible to someone else?
- If a bug appears, is it a local defect or a design mismatch?

## Execution Posture

- Start diff-aware, not checklist-first.
- Prefer browser-first evidence for UI surfaces and executable traces for CLI or
  service behavior.
- If QA applies a bounded fix, rerun the same failing path before closing it.
- If basic test harness setup is missing but local to the task, bootstrap the
  minimum viable path and record what was added.

## Evidence Priorities

- browser snapshots or screenshots for UI behavior
- executable command output for CLI, service, or build flows
- precise reproduction steps for any remaining failures
- after-fix proof if QA applied a bounded repair

## Anti-Patterns

- generic click-around with no target risk
- mistaking test logs for user-flow evidence
- accumulating many weak findings instead of proving the main risky flow
