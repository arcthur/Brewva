---
name: qa
description: Verify the shipped behavior through realistic flows, fix bounded defects
  when justified, and leave reproducible evidence for release decisions.
stability: stable
intent:
  outputs:
    - qa_report
    - qa_findings
    - qa_verdict
    - qa_artifacts
  output_contracts:
    qa_report:
      kind: text
      min_words: 3
      min_length: 18
    qa_findings:
      kind: json
      min_items: 1
    qa_verdict:
      kind: enum
      values:
        - pass
        - needs_fixes
        - blocked
    qa_artifacts:
      kind: json
      min_items: 1
effects:
  allowed_effects:
    - workspace_read
    - workspace_write
    - local_exec
    - runtime_observe
resources:
  default_lease:
    max_tool_calls: 110
    max_tokens: 190000
  hard_ceiling:
    max_tool_calls: 150
    max_tokens: 250000
execution_hints:
  preferred_tools:
    - browser_open
    - browser_wait
    - browser_snapshot
    - browser_click
    - browser_fill
    - browser_screenshot
    - browser_diff_snapshot
    - exec
    - read
    - edit
  fallback_tools:
    - browser_get
    - grep
    - skill_complete
references:
  - skills/meta/skill-authoring/references/authored-behavior.md
  - references/exploratory-regression-checklist.md
consumes:
  - design_spec
  - execution_plan
  - execution_mode_hint
  - risk_register
  - change_set
  - files_changed
  - verification_evidence
  - review_report
  - review_findings
  - merge_decision
requires: []
---

# QA Skill

## Intent

Test the actual behavior, not just the intended diff, and turn real failures
into bounded fixes or concrete release blockers.

## Trigger

Use this skill when:

- the next question is whether the feature really works in realistic usage
- browser or executable behavior matters more than static code inspection
- release confidence requires test, fix, and re-verify work

## Workflow

### Step 1: Establish a credible starting state

Identify whether the environment is testable, whether the target flow is
reachable, and whether the current branch or workspace state is coherent enough
to interpret failures.

If the environment, auth, or target URL is broken, say so early and classify it
as a blocker. Do not bury setup failure inside a vague QA summary.

### Step 2: Reconstruct the risk surface from the actual diff

Start from `change_set`, `files_changed`, `risk_register`, `review_findings`,
and the intended user flow. Prefer a diff-aware test path over generic
click-around.

### Step 3: Run the highest-value test path

Prefer realistic end-to-end behavior over synthetic checklists. Use browser
evidence when the product surface is UI-driven; use executable verification when
the change is service or CLI heavy.

### Step 4: Decide whether to fix, report, or block

Fix bounded defects when the repair is local and confidence can be re-earned in
the same session. If the issue implies design drift, unclear ownership, or weak
reproduction, stop and report instead of guessing.

### Step 5: Emit QA artifacts

Produce:

- `qa_report`: tested flows, what passed, what failed, and what changed
- `qa_findings`: ranked failures or residual concerns
- `qa_verdict`: `pass`, `needs_fixes`, or `blocked`
- `qa_artifacts`: screenshots, snapshots, commands, traces, or saved states

## Interaction Protocol

- Ask only when the environment, target URL, credentials, or acceptance target
  are too unclear to test safely.
- Prefer browser-first evidence when the user risk is visible behavior. Do not
  substitute static reasoning for the real flow when the UI is the product.
- Re-ground on the changed user flow before opening the browser or running
  executable checks.
- Recommend the release path you believe the evidence supports. Do not hide
  behind a neutral report when the right verdict is obvious.

## QA Questions

Use these questions to pick the right test path:

- Which user-visible path is most likely to fail for the reasons this diff is risky?
- What setup or environment assumption must be true before this result means anything?
- If the first failing path passes, what second path would still meaningfully reduce uncertainty?
- What evidence must be captured now so `ship` does not have to trust prose?

## Test Execution Protocol

- Start from the narrowest realistic flow that can fail for the reasons this
  diff is dangerous.
- Use `files_changed`, `risk_register`, and `review_findings` to pick the first
  path. QA is not a generic tour of the app.
- Treat saved snapshots, screenshots, command output, and after-fix reruns as
  first-class evidence. If evidence cannot be replayed by another operator, it
  is too weak.
- When setup is missing but repair is bounded, bootstrap the minimum viable test
  harness and record what had to be introduced.

## QA Decision Protocol

- Prefer the narrowest realistic flow that can prove or disprove release
  confidence quickly.
- Fix only when the defect is local, the repair path is obvious, and you can
  re-verify immediately.
- After any bounded fix, rerun the failing path before claiming restored
  confidence.
- Report instead of fixing when the defect points to wrong scope, wrong design,
  or missing product decisions.
- Treat missing environments, broken auth, and irreproducible behavior as
  blockers, not as silent skips.

## Release Confidence Gate

- [ ] The highest-risk realistic path was actually exercised.
- [ ] The observed result is backed by replayable evidence.
- [ ] Any bounded fix was re-verified on the failing path.
- [ ] Remaining uncertainty is named as a real blocker or residual risk.

## Handoff Expectations

- `qa_report` should tell `ship` exactly what was exercised, what changed during
  QA, and what confidence level was earned.
- `qa_findings` should be reproducible and actionable, not generic complaints.
- `qa_verdict` should summarize real release confidence, not just the count of
  found issues.
- `qa_artifacts` should preserve screenshots, snapshots, commands, logs, or
  saved states so later release or debugging work does not restart from zero.
- The handoff should explain which risky path was exercised first, why that path
  was chosen, and whether QA changed code before reaching the final verdict.

## Stop Conditions

- the target environment cannot be reached or exercised credibly
- the real blocker is unresolved design or review debt, not QA execution
- the requested product surface cannot be tested with current access

## Anti-Patterns

- calling unit-test output "QA" without checking real behavior
- fixing broad product issues inside QA without naming the design problem
- skipping browser or runtime evidence when the user-facing flow is the actual risk
- reporting results without a release-oriented verdict

## Example

Input: "Exercise the staging onboarding flow, fix any small regressions, and tell me if this is safe to ship."

Output: `qa_report`, `qa_findings`, `qa_verdict`, `qa_artifacts`.
