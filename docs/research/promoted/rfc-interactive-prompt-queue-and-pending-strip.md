# Research: Interactive Prompt Queue And Pending Strip

## Document Metadata

- Status: `promoted`
- Owner: cli + gateway maintainers
- Last reviewed: `2026-04-27`
- Promotion target:
  - `docs/journeys/operator/interactive-session.md`
  - `docs/reference/session-lifecycle.md`
  - `docs/reference/commands.md`
  - `docs/guide/cli.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- interactive composer submissions made during streaming default to queued
  delivery instead of requiring an explicit `streamingBehavior`
- explicit `followUp` remains a separate continuation semantic and does not
  become a user-visible queue item
- queued prompt observation and removal are prompt-id based
- the interactive shell surfaces queued prompts through a compact pending strip
  and a `Ctrl+B` queue overlay for inspect/delete actions
- no `/queue` slash command is introduced; queue remains a state surface rather
  than a mode toggle

## Stable References

- `docs/journeys/operator/interactive-session.md`
- `docs/reference/session-lifecycle.md`
- `docs/reference/commands.md`
- `docs/guide/cli.md`

## Stable Contract Summary

1. Interactive streaming now defaults to queue.
   The ordinary composer path submits a future turn when the current turn is
   still streaming; callers only specify `streamingBehavior` when they need a
   non-default low-level semantic such as explicit `followUp`.
2. Queue identity is authoritative and prompt-id based.
   Managed sessions expose queued prompt views carrying `promptId`, text,
   `submittedAt`, and `behavior`, and queued removal is id-based plus
   race-safe/idempotent.
3. Queue UX is queue-only and operator-visible.
   The pending strip renders up to three `(pending)` rows, then `+N more ·
Ctrl+B to manage`; the queue overlay exposes detail inspection and deletion
   without aborting the active turn.
4. `followUp` stays distinct.
   Explicit `followUp` callers remain explicit continuation flows and do not
   appear in the queue strip or queue overlay.
5. Queue is not a slash-mode feature.
   The shell exposes queue management through keybinding/palette discovery
   rather than a dedicated `/queue` command.

## Validation Status

Promotion is backed by:

- substrate, agent-engine, gateway, and CLI implementation changes that carry
  prompt-id-based queued prompt observation/removal end to end
- CLI runtime and OpenTUI coverage for queue projection, pending-strip
  rendering, overlay inspection/deletion, and session-switch queue seeding
- managed-session and substrate coverage for queued removal semantics
- stable-doc updates in the operator journey, session lifecycle reference,
  commands reference, and CLI guide
- repository verification via `bun run check`, `bun test`, `bun run test:docs`,
  and `bun run format:docs:check`

## Source Anchors

- `packages/brewva-agent-engine/src/brewva-agent-engine.ts`
- `packages/brewva-gateway/src/host/managed-agent-session.ts`
- `packages/brewva-substrate/src/session/prompt-session.ts`
- `packages/brewva-substrate/src/session/session-host.ts`
- `packages/brewva-cli/src/shell/types.ts`
- `packages/brewva-cli/src/shell/state/index.ts`
- `packages/brewva-cli/src/shell/runtime.ts`
- `packages/brewva-cli/src/shell/overlay-view.ts`
- `packages/brewva-cli/src/shell/flows/overlay-lifecycle-flow.ts`
- `packages/brewva-cli/src/shell/commands/shell-command-registry.ts`
- `packages/brewva-cli/runtime/shell/prompt.tsx`
- `packages/brewva-cli/runtime/shell/overlay.tsx`

## Remaining Backlog

The following ideas are intentionally outside the promoted contract:

- exposing explicit `followUp` items in the queue strip or queue overlay
- queue reordering or priority editing
- a dedicated `/queue` slash command or queue mode toggle
- widening queue management to non-interactive or channel-first submission paths

If future work reopens those directions, it should start from a new focused RFC
rather than widening this promoted pointer back into an active design note.

## Historical Notes

- The active RFC previously carried rollout detail and option analysis while the
  implementation was still moving.
- After promotion, stable docs and tests became the contract; this file now
  preserves only the accepted boundary and non-goals.
