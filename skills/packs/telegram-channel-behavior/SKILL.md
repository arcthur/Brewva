---
name: telegram-channel-behavior
description: Response behavior strategy for the Telegram channel. Constrains response pacing, interaction fallback behavior, text readability, and failure reporting in Telegram conversations, and works together with telegram-interactive-components.
stability: stable
effect_level: read_only
tools:
  required: [skill_load]
  optional: [skill_complete]
  denied: []
budget:
  max_tool_calls: 20
  max_tokens: 60000
outputs: [channel_response_plan, fallback_policy]
requires: []
consumes: [objective, inbound_event, constraints]
composable_with: [telegram-interactive-components]
---

# Telegram Channel Behavior

## Intent

Generate stable, clear, and executable reply strategies for Telegram, with priority on:

1. User readability
2. Channel compatibility
3. Graceful fallback when interactive features fail

## Trigger Conditions

- The current message comes from the Telegram channel.
- A clear strategy is needed before the final response: "plain text vs interactive components."
- The response must provide executable next steps under Telegram constraints (confirm, cancel, retry, continue).

## Workflow

1. Start with user-readable text and briefly explain the current status and next step.
2. Decide whether interactive components are truly needed (buttons, confirmation, pagination).
3. Only if interaction is genuinely needed, call `skill_load(name="telegram-interactive-components")`.
4. If interaction is not needed, keep the response plain text and do not output a `telegram-ui` code block.

## Response Strategy

- Give the conclusion first, then the action.
- Focus each response on one decision point; avoid long parallel instruction lists.
- On failure, explicitly state three things: failure reason, what has already completed, and the recommended next step.
- When interactive capability is unavailable, always provide a plain-text fallback instruction (for example: `Reply with: confirm or cancel`).

## Collaboration Boundary with the Interactive Skill

- This skill decides whether interaction is needed, how to degrade gracefully, and how to structure copy.
- `telegram-interactive-components` is responsible for generating the `telegram-ui` structure.
- Do not invent new UI schemas in this skill.

## Termination Conditions

- An executable Telegram reply text has been provided, including the required fallback path.
- If interactive components are enabled, control has been handed to `telegram-interactive-components` and output is completed.

## Anti-Patterns

- Forcing `telegram-ui` output in scenarios that do not need interaction.
- Outputting only button semantics without a plain-text fallback path.
- Replying to failures with only "something went wrong" and no executable next step.
