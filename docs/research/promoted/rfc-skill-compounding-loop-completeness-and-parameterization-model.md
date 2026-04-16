# Research: Skill Compounding Loop Completeness and Parameterization Model

## Document Metadata

- Status: `promoted`
- Owner: runtime and gateway maintainers
- Last reviewed: `2026-04-16`
- Promotion target:
  - `docs/reference/skills.md`
  - `docs/reference/configuration.md`
  - `docs/reference/events.md`
  - `docs/solutions/README.md`

## Promotion Summary

This note is now a promoted status pointer.

The promoted decisions are:

- repository-native precedent capture stays outside `retro` / `ship` execution
  and is expressed as a post-skill `knowledge_capture` handoff rather than an
  in-skill write path
- autonomous `self-improve` is owned by project config through
  `schedule.selfImprove`, reconciled by the gateway daemon as one durable
  recurring intent plus a fixed parent session carrying the TaskSpec and active
  skill
- scheduled `self-improve` remains proposal-only and repeat-gated: the loop may
  derive promotion candidates, but it does not bypass `workspace_write` denial
  and it does not materialize drafts from a single occurrence
- skill invocation parameterization stays TaskSpec-first; Brewva does not add a
  public `SkillContract.parameters` surface in this contract pass

## Stable References

- `docs/reference/skills.md`
- `docs/reference/configuration.md`
- `docs/reference/events.md`
- `docs/solutions/README.md`

## Stable Contract Summary

The promoted contract is:

1. `docs/solutions/**` is the canonical repository-native precedent layer, and
   systemic `retro` / `ship` findings hand off to `knowledge_capture` as a
   separate step instead of violating `workspace_write` boundaries.
2. `schedule.selfImprove` is the stable policy surface for autonomous
   self-improve scheduling. The gateway daemon seeds or reconciles the durable
   recurring intent and its parent session idempotently.
3. Scheduled continuity may carry the parent TaskSpec, truth context, anchor,
   and active skill into the child run. If inherited skill activation fails, the
   runtime records `schedule_trigger_apply_warning` so the degradation is
   inspectable rather than silent.
4. `self-improve` promotion evidence must remain repeat-backed. A single
   occurrence is insufficient to derive a promotion draft.
5. TaskSpec remains the machine-readable invocation surface for reusable skills:
   `goal`, `expectedBehavior`, `constraints`, and explicit targets are the
   accepted way to parameterize the subject of a skill run.

## Current Implementation Notes

- `skills/core/retro/SKILL.md` and `skills/core/ship/SKILL.md` now document the
  post-skill capture handoff instead of any inline write path.
- `skills/meta/self-improve/SKILL.md` documents the quiet no-signal exit posture
  for scheduled runs that do not find repeat-backed evidence.
- `docs/solutions/schedule/autonomous-self-improve-schedule-parent-session.md`
  records the fixed-parent-session precedent for recurring self-improve.
- `packages/brewva-gateway/src/daemon/gateway-daemon.ts`,
  `packages/brewva-gateway/src/daemon/schedule-runner.ts`, and
  `packages/brewva-gateway/src/session/schedule-trigger.ts` carry the durable
  autonomous scheduling and continuity implementation.

## Validation Status

Promotion is backed by:

- unit, contract, and system coverage for repeat-gated skill promotion drafts,
  schedule trigger continuity, and daemon-side autonomous self-improve seeding
- runtime event coverage for `schedule_trigger_apply_warning`
- repository verification gates:
  `bun run check`, `bun test`, `bun run test:docs`, and
  `bun run format:docs:check`

## Remaining Backlog

The following ideas are intentionally outside the promoted contract:

- broker-owned count-gated or age-gated autonomous trigger policies layered on
  top of the current cron-backed `schedule.selfImprove` path
- a public `SkillContract.parameters` surface or migration of existing skill
  frontmatter toward declared parameters
- any autonomous write path that would let scheduled `self-improve` bypass
  promotion review or `workspace_write` denial

If future work changes those boundaries, it should begin from a new focused RFC
rather than reopening this promoted status pointer.

## Historical Notes

- The active note's option analysis and open-decision framing were removed after
  the accepted contract moved into stable docs, skill docs, solution records,
  and tests.
- Operator observation of future long-running autonomous self-improve cycles can
  be tracked as operational evidence without turning this file back into an
  active design note.
