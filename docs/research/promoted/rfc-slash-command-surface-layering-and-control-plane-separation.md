# Research: Slash Command Surface Layering And Control-Plane Separation

## Document Metadata

- Status: `promoted`
- Owner: cli, gateway, and operator-surface maintainers
- Last reviewed: `2026-04-26`
- Promotion target:
  - `docs/reference/commands.md`
  - `docs/reference/runtime-plugins.md`
  - `docs/guide/cli.md`
  - `docs/guide/channel-agent-workspace.md`
  - `docs/journeys/operator/interactive-session.md`

## Promotion Summary

This note is now a short status pointer.

The decision has been promoted: Brewva treats slash commands as layered product
surfaces rather than one flat namespace shared by the interactive shell,
runtime-plugin commands, and channel orchestration.

Stable implementation now includes:

- explicit shell discoverability surfaces for slash, palette, help, and
  keybinding instead of one coarse `hidden` switch
- a shell slash contract centered on canonical interactive entrypoints such as
  `/model`, `/inbox`, `/inspect`, `/answer`, session-history actions,
  approvals, tasks, and theme selection
- palette-first handling for lower-signal view/config/draft commands rather than
  presenting them as top-level slash choices
- explicit reserved shell slash names so runtime-owned commands can reserve a
  name without being advertised or silently reoccupied by the shell later
- runtime-plugin ownership that remains available for headless or managed
  sessions without pretending to be part of the same interactive shell surface
- a distinct channel control plane centered on `/status`, `/agent ...`,
  `/agents`, `/focus`, `/run`, `/discuss`, and `/answer`
- `/status` replies that keep section-level structured metadata for cost,
  operator input, inspect, and insights instead of collapsing all channel
  control output into one opaque summary

Stable references:

- `docs/reference/commands.md`
- `docs/reference/runtime-plugins.md`
- `docs/guide/cli.md`
- `docs/guide/channel-agent-workspace.md`
- `docs/journeys/operator/interactive-session.md`

## Stable Contract Summary

The promoted contract is:

1. Interactive shell slash is shell-owned.
   Interactive `/...` parsing resolves through the shell command provider, and
   the shell decides what is promoted, palette-only, help-visible, or reserved.
2. Discoverability is separate from capability.
   A command may remain runnable from palette, keybinding, or internal flows
   without implying that it should appear in slash completion or help as a `/`
   command.
3. Reserved names are first-class.
   Runtime-owned names such as `/questions`, `/insights`, `/update`, and
   `/agent-overlays` can remain non-advertised while still being protected from
   future shell reoccupation.
4. Runtime-plugin commands remain headless/non-TUI surfaces.
   `inspect`, `insights`, `questions`, `answer`, `agent-overlays`, and `update`
   stay available through runtime registration and are documented separately
   from interactive shell ownership.
5. Channel commands are a separate control plane.
   Channel grammar is not treated as an extension of TUI slash. Its canonical
   operator surface is `/status`, `/agent ...`, `/agents`, `/focus`, `/run`,
   `/discuss`, and `/answer`.
6. Removed compatibility paths stay removed.
   The promoted contract does not preserve legacy public slash aliases such as
   `/models`, `/connect`, `/think`, `/cost`, `/new-agent`, or `/del-agent` as
   advertised compatibility shims.

## Validation Status

Promotion is backed by:

- shell command-provider coverage for slash/palette/help separation and reserved
  slash names
- shell runtime coverage for canonical slash completion and reserved-name
  interception
- channel router and control-router coverage for `/status` and `/agent ...`
  semantics plus section-level status metadata
- docs aligned across command reference, runtime-plugin reference, CLI guide,
  channel workspace guide, and operator interactive-session journey
- repository verification via `bun run check`, `bun run test:docs`, `bun test`,
  and `bun run test:dist`

## Source Anchors

- `packages/brewva-cli/src/shell/commands/command-provider.ts`
- `packages/brewva-cli/src/shell/commands/command-palette.ts`
- `packages/brewva-cli/src/shell/commands/shell-command-registry.ts`
- `packages/brewva-cli/src/shell/completion-provider.ts`
- `packages/brewva-cli/src/shell/runtime.ts`
- `packages/brewva-cli/src/questions-command-runtime-plugin.ts`
- `packages/brewva-cli/src/inspect-command-runtime-plugin.ts`
- `packages/brewva-cli/src/insights-command-runtime-plugin.ts`
- `packages/brewva-cli/src/agent-overlays-command-runtime-plugin.ts`
- `packages/brewva-cli/src/update-command-runtime-plugin.ts`
- `packages/brewva-gateway/src/channels/command-router.ts`
- `packages/brewva-gateway/src/channels/channel-control-router.ts`

## Remaining Backlog

The following follow-ons are intentionally not required for the promoted
contract:

- folding `/tasks` into `/inbox`
- routing provider connection entirely through `/model` without a separate
  provider picker concept
- widening `agent-overlays` back into an interactive shell surface
- reintroducing transitional aliases for retired slash names

If future work reopens any of those directions, it should start from a new
focused RFC instead of expanding this promoted pointer back into an active
proposal.

## Historical Notes

- Historical option analysis, migration-phase detail, and pre-cutover command
  counts were removed from this file after promotion.
- The accepted command-surface contract now lives in stable docs and tests
  rather than in `docs/research/active/`.
