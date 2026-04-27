# Research: In-Flight `steer` Control Primitive

## Document Metadata

- Status: `promoted`
- Owner: runtime maintainers
- Last reviewed: `2026-04-27`
- Promotion target:
  - `docs/reference/session-lifecycle.md`
  - `docs/architecture/invariants-and-reliability.md`
  - `docs/reference/commands.md`
  - `docs/reference/gateway-control-plane-protocol.md`

## Promotion Summary

This note is now a promoted status pointer.

The accepted decision is:

- `steer` is the canonical in-flight control primitive
- the former queued `steer` prompt path is renamed to `queue`
- steer appends guidance to the final tool-result boundary of the current tool
  batch instead of creating a new `role:"user"` message
- the committed `message_end(toolResult)` remains the replay authority; steer
  audit events are secondary observability
- channel and gateway control planes expose the same live-session `steer`
  semantics without reusing busy `send` behavior

## Stable References

- `docs/reference/session-lifecycle.md`
- `docs/architecture/invariants-and-reliability.md`
- `docs/reference/commands.md`
- `docs/reference/gateway-control-plane-protocol.md`

## Stable Contract Summary

1. `steer` means in-flight tool-result guidance only.
   It appends guidance text to the last tool-result message of the current tool
   batch and never creates a new transcript user turn.
2. `queue` means queued prompt delivery only.
   Queued prompts remain explicit `role:"user"` messages delivered between the
   current tool batch and the next assistant call.
3. Transcript authority stays on committed tool results.
   Replay, session projection, and future model context all follow the final
   committed `message_end(toolResult)` output, not the steer audit event.
4. Gateway and channel controls preserve the same semantics.
   `sessions.steer` and `/steer` target the live managed session and do not
   silently fall back to queued prompt delivery.
5. Plugin transforms remain authoritative after append.
   If a `message_end` plugin replaces tool-result content after steer append, the
   committed plugin result becomes the durable transcript and
   `steer_applied.message` follows that committed message.

## Validation Status

Promotion is backed by:

- engine, managed-session, CLI, gateway, channel, and protocol implementation
  changes that fully switched the naming contract to `steer` / `queue`
- focused regression coverage in
  `test/unit/gateway/steer-control-primitive.unit.test.ts`
- repository verification via `bun run check`, `bun run test`,
  `bun run test:docs`, `bun run format:docs:check`, and `bun run test:dist`

## Historical Notes

- Hermes' `/steer` was the semantic precedent for the in-flight primitive.
- Brewva originally used `steer` for queued prompt delivery; that meaning was
  intentionally retired rather than preserved as a compatibility alias.
