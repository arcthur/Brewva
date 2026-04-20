import {
  getSkillSemanticBindings,
  listSkillOutputs,
  SKILL_REPAIR_ALLOWED_TOOL_NAMES,
  type BrewvaHostedRuntimePort,
  type SkillDocument,
} from "@brewva/brewva-runtime";
import { renderSemanticArtifactExample } from "@brewva/brewva-runtime/internal";
import type {
  BrewvaHostAgentEndEvent,
  BrewvaHostBeforeAgentStartEvent,
  BrewvaHostContext,
  BrewvaHostMessageEndEvent,
  BrewvaHostMessageEndResult,
  BrewvaHostMessageEnvelope,
  BrewvaHostMessageVisibilityPatch,
  BrewvaHostPluginApi,
  BrewvaHostSessionShutdownEvent,
  BrewvaHostTurnEndEvent,
} from "@brewva/brewva-substrate";
import { buildSkillFirstPolicyBlock, deriveSkillRecommendations } from "./skill-first.js";

const MAX_NUDGES_PER_PROMPT = 2;

function formatGuardMessage(
  skill: SkillDocument,
  activeState: NonNullable<
    ReturnType<BrewvaHostedRuntimePort["inspect"]["skills"]["getActiveState"]>
  >,
  latestFailure: ReturnType<BrewvaHostedRuntimePort["inspect"]["skills"]["getLatestFailure"]>,
): string {
  const outputs = listSkillOutputs(skill.contract);
  const semanticBindings = getSkillSemanticBindings(skill.contract);
  const lines = [
    "[Brewva Completion Guard]",
    `Active skill is still active: ${skill.name} phase=${activeState.phase}`,
    "",
    "You MUST complete the active skill before stopping.",
    "Call tool `skill_complete` with `outputs` that satisfy the contract.",
    "",
    "Required outputs:",
    ...(outputs.length > 0
      ? outputs.map((outputName) => {
          const schemaId = semanticBindings?.[outputName];
          return schemaId ? `- ${outputName} [${schemaId}]` : `- ${outputName}`;
        })
      : ["- (none)"]),
  ];

  if (activeState.phase === "repair_required") {
    lines.push("");
    lines.push(
      `Repair posture is active. Only the repair allowlist remains available: ${SKILL_REPAIR_ALLOWED_TOOL_NAMES.join(", ")}.`,
    );
    if (activeState.repairBudget) {
      lines.push(
        `Remaining repair budget: attempts=${activeState.repairBudget.remainingAttempts}, tool_calls=${activeState.repairBudget.remainingToolCalls}, token_budget=${activeState.repairBudget.tokenBudget}, used_tokens=${activeState.repairBudget.usedTokens ?? "unknown"}`,
      );
    }
    if (latestFailure) {
      lines.push(
        `Latest rejection: missing=${
          latestFailure.missing.length > 0 ? latestFailure.missing.join(", ") : "none"
        }; invalid=${
          latestFailure.invalid.length > 0
            ? latestFailure.invalid
                .map((issue) => (issue.schemaId ? `${issue.name}[${issue.schemaId}]` : issue.name))
                .join(", ")
            : "none"
        }`,
      );
      if (latestFailure.repairGuidance) {
        lines.push("");
        lines.push(
          `Minimum acceptable contract state: ${latestFailure.repairGuidance.minimumContractState}`,
        );
        lines.push(
          `Unresolved Tier A/B fields: ${
            latestFailure.repairGuidance.unresolvedFields.length > 0
              ? latestFailure.repairGuidance.unresolvedFields.join(", ")
              : "none"
          }`,
        );
        lines.push(
          `Next blocking consumer: ${latestFailure.repairGuidance.nextBlockingConsumer ?? "none"}`,
        );
      }
    }
    return lines.join("\n");
  }

  const semanticExamples = Object.entries(semanticBindings ?? {})
    .slice(0, 2)
    .map(
      ([outputName, schemaId]) =>
        `- ${outputName} example: ${renderSemanticArtifactExample(schemaId)}`,
    );
  if (semanticExamples.length > 0) {
    lines.push("");
    lines.push("Canonical examples:");
    lines.push(...semanticExamples);
  }
  return lines.join("\n");
}

function formatSkillLoadGuardMessage(
  recommendations: ReturnType<typeof deriveSkillRecommendations>,
): string | null {
  const policyBlock = buildSkillFirstPolicyBlock(recommendations);
  const primary = recommendations.recommendations[0];
  if (!policyBlock || !primary) {
    return null;
  }
  return [
    "[Brewva Skill-First Guard]",
    "A routed skill is pending and no active skill is loaded.",
    `Call tool \`skill_load\` with name \`${primary.name}\` before producing a final answer.`,
    "",
    policyBlock,
  ].join("\n");
}

function formatSkillContractFailedGuardMessage(input: {
  failure: NonNullable<
    ReturnType<BrewvaHostedRuntimePort["inspect"]["skills"]["getLatestFailure"]>
  >;
}): string {
  const lines = [
    "[Brewva Completion Guard]",
    `Skill contract failed: ${input.failure.skillName}`,
    "",
    "Brewva will not start downstream skills or continue repository work from an invalid skill output contract.",
    "Inspect the rejected contract state, then restart the task or explicitly repair it through an operator-approved path.",
    "",
    `Missing outputs: ${input.failure.missing.length > 0 ? input.failure.missing.join(", ") : "none"}`,
    `Invalid outputs: ${
      input.failure.invalid.length > 0
        ? input.failure.invalid
            .map((issue) => (issue.schemaId ? `${issue.name}[${issue.schemaId}]` : issue.name))
            .join(", ")
        : "none"
    }`,
  ];

  if (input.failure.repairGuidance) {
    lines.push("");
    lines.push(`Minimum contract state: ${input.failure.repairGuidance.minimumContractState}`);
    lines.push(
      `Unresolved fields: ${
        input.failure.repairGuidance.unresolvedFields.length > 0
          ? input.failure.repairGuidance.unresolvedFields.join(", ")
          : "none"
      }`,
    );
  }

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalAssistantMessage(message: unknown): boolean {
  const record = isRecord(message) ? message : undefined;
  if (record?.role !== "assistant") {
    return false;
  }
  return record.stopReason === "stop" || record.stopReason === "length";
}

function suppressAssistantDraft(input: {
  message: BrewvaHostMessageEnvelope;
  reason: "active_skill_incomplete" | "skill_load_pending" | "skill_contract_failed";
  skillName?: string;
  obligation?: string;
}): BrewvaHostMessageVisibilityPatch {
  const existingDetails = isRecord(input.message.details) ? input.message.details : {};
  return {
    display: false,
    excludeFromContext: true,
    details: {
      ...existingDetails,
      brewvaDraftSuppressed: {
        reason: input.reason,
        ...(input.skillName ? { skillName: input.skillName } : {}),
        ...(input.obligation ? { obligation: input.obligation } : {}),
      },
    },
  };
}

export function registerCompletionGuard(
  extensionApi: BrewvaHostPluginApi,
  runtime: BrewvaHostedRuntimePort,
): void {
  const lifecycle = createCompletionGuardLifecycle(extensionApi, runtime);
  extensionApi.on("before_agent_start", lifecycle.beforeAgentStart);
  extensionApi.on("message_end", lifecycle.messageEnd);
  extensionApi.on("turn_end", lifecycle.turnEnd);
  extensionApi.on("agent_end", lifecycle.agentEnd);
  extensionApi.on("session_shutdown", lifecycle.sessionShutdown);
}

export interface CompletionGuardLifecycle {
  beforeAgentStart: (event: BrewvaHostBeforeAgentStartEvent, ctx: BrewvaHostContext) => undefined;
  messageEnd: (
    event: BrewvaHostMessageEndEvent,
    ctx: BrewvaHostContext,
  ) => BrewvaHostMessageEndResult | undefined;
  turnEnd: (event: BrewvaHostTurnEndEvent, ctx: BrewvaHostContext) => undefined;
  agentEnd: (event: BrewvaHostAgentEndEvent, ctx: BrewvaHostContext) => undefined;
  sessionShutdown: (event: BrewvaHostSessionShutdownEvent, ctx: BrewvaHostContext) => undefined;
}

function isTerminalAssistantTurn(event: BrewvaHostTurnEndEvent): boolean {
  const message = event.message as { role?: unknown; stopReason?: unknown } | undefined;
  if (message?.role !== "assistant") {
    return false;
  }
  if (message.stopReason !== "stop" && message.stopReason !== "length") {
    return false;
  }
  return event.toolResults.length === 0;
}

export function createCompletionGuardLifecycle(
  extensionApi: BrewvaHostPluginApi,
  runtime: BrewvaHostedRuntimePort,
): CompletionGuardLifecycle {
  const nudgeCounts = new Map<string, number>();
  const latestPromptBySession = new Map<string, string>();
  const failureGuardKeyBySession = new Map<string, string>();

  function enqueueFailedContractNotice(
    sessionId: string,
    latestFailure: ReturnType<BrewvaHostedRuntimePort["inspect"]["skills"]["getLatestFailure"]>,
  ): void {
    if (!latestFailure || latestFailure.phase !== "failed_contract") {
      failureGuardKeyBySession.delete(sessionId);
      return;
    }
    const failureKey = `${latestFailure.skillName}:${latestFailure.occurredAt}`;
    if (failureGuardKeyBySession.get(sessionId) === failureKey) {
      return;
    }
    failureGuardKeyBySession.set(sessionId, failureKey);
    extensionApi.sendMessage(
      {
        customType: "brewva-guard",
        content: formatSkillContractFailedGuardMessage({ failure: latestFailure }),
        display: true,
        details: {
          sessionId,
          skill: latestFailure.skillName,
          obligation: "skill_contract_failed",
          phase: latestFailure.phase,
        },
      },
      { deliverAs: "transcript", triggerTurn: false },
    );
  }

  function enqueueCompletionGuardFollowUp(sessionId: string, ctx: BrewvaHostContext): void {
    const active = runtime.inspect.skills.getActive(sessionId);
    const activeState = runtime.inspect.skills.getActiveState(sessionId);
    if (!active) {
      const recommendations = deriveSkillRecommendations(runtime, {
        sessionId,
        prompt: latestPromptBySession.get(sessionId) ?? "",
      });
      const latestFailure = runtime.inspect.skills.getLatestFailure(sessionId);
      if (recommendations.gateMode === "skill_contract_failed") {
        nudgeCounts.delete(sessionId);
        enqueueFailedContractNotice(sessionId, latestFailure);
        return;
      }
      if (
        recommendations.activeSkillName ||
        recommendations.gateMode !== "skill_load_required" ||
        recommendations.recommendations.length === 0
      ) {
        nudgeCounts.delete(sessionId);
        return;
      }

      const count = (nudgeCounts.get(sessionId) ?? 0) + 1;
      nudgeCounts.set(sessionId, count);
      const content = formatSkillLoadGuardMessage(recommendations);
      if (!content) {
        nudgeCounts.delete(sessionId);
        return;
      }
      if (count > MAX_NUDGES_PER_PROMPT) {
        ctx.ui.notify(
          `Brewva guard: routed skill '${recommendations.recommendations[0]?.name}' was not loaded before final answer.`,
          "warning",
        );
        return;
      }
      extensionApi.sendMessage(
        {
          customType: "brewva-guard",
          content,
          display: true,
          details: {
            sessionId,
            skill: recommendations.recommendations[0]?.name,
            count,
            obligation: "skill_load",
          },
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
      return;
    }
    if (!activeState) {
      nudgeCounts.delete(sessionId);
      return;
    }

    const count = (nudgeCounts.get(sessionId) ?? 0) + 1;
    nudgeCounts.set(sessionId, count);

    if (count > MAX_NUDGES_PER_PROMPT) {
      ctx.ui.notify(
        `Brewva guard: active skill '${active.name}' was not completed (missing skill_complete).`,
        "warning",
      );
      return;
    }

    extensionApi.sendMessage(
      {
        customType: "brewva-guard",
        content: formatGuardMessage(
          active,
          activeState,
          runtime.inspect.skills.getLatestFailure(sessionId),
        ),
        display: true,
        details: { sessionId, skill: active.name, count },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }

  return {
    beforeAgentStart(event, ctx) {
      latestPromptBySession.set(ctx.sessionManager.getSessionId(), event.prompt);
      return undefined;
    },
    messageEnd(event, ctx) {
      if (!isTerminalAssistantMessage(event.message)) {
        return undefined;
      }
      const sessionId = ctx.sessionManager.getSessionId();
      const active = runtime.inspect.skills.getActive(sessionId);
      if (active) {
        return {
          visibility: suppressAssistantDraft({
            message: event.message,
            reason: "active_skill_incomplete",
            skillName: active.name,
            obligation: "skill_complete",
          }),
        };
      }

      const recommendations = deriveSkillRecommendations(runtime, {
        sessionId,
        prompt: latestPromptBySession.get(sessionId) ?? "",
      });
      if (recommendations.gateMode === "skill_contract_failed") {
        const latestFailure = runtime.inspect.skills.getLatestFailure(sessionId);
        return {
          visibility: suppressAssistantDraft({
            message: event.message,
            reason: "skill_contract_failed",
            skillName: latestFailure?.skillName,
            obligation: "operator_intervention",
          }),
        };
      }
      const primary = recommendations.recommendations[0];
      if (recommendations.gateMode === "skill_load_required" && primary) {
        return {
          visibility: suppressAssistantDraft({
            message: event.message,
            reason: "skill_load_pending",
            skillName: primary.name,
            obligation: "skill_load",
          }),
        };
      }
      return undefined;
    },
    turnEnd(event, ctx) {
      if (!isTerminalAssistantTurn(event)) {
        return undefined;
      }
      const sessionId = ctx.sessionManager.getSessionId();
      enqueueCompletionGuardFollowUp(sessionId, ctx);
      return undefined;
    },
    agentEnd(_event, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const active = runtime.inspect.skills.getActive(sessionId);
      const activeState = runtime.inspect.skills.getActiveState(sessionId);
      if (!active) {
        nudgeCounts.delete(sessionId);
        return undefined;
      }
      if (!activeState) {
        nudgeCounts.delete(sessionId);
        return undefined;
      }

      ctx.ui.notify(
        `Brewva guard: active skill '${active.name}' reached agent_end without skill_complete.`,
        "warning",
      );

      return undefined;
    },
    sessionShutdown(_event, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      nudgeCounts.delete(sessionId);
      latestPromptBySession.delete(sessionId);
      failureGuardKeyBySession.delete(sessionId);
      return undefined;
    },
  };
}
