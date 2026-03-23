export type ContextInjectionCategory = "narrative" | "constraint" | "diagnostic";

export const CONTEXT_SOURCES = {
  identity: "brewva.identity",
  deliberationMemory: "brewva.deliberation-memory",
  optimizationContinuity: "brewva.optimization-continuity",
  skillPromotionDrafts: "brewva.skill-promotion-drafts",
  runtimeStatus: "brewva.runtime-status",
  taskState: "brewva.task-state",
  toolOutputsDistilled: "brewva.tool-outputs-distilled",
  projectionWorking: "brewva.projection-working",
} as const;

export type ContextSourceId = (typeof CONTEXT_SOURCES)[keyof typeof CONTEXT_SOURCES];

export const CONTEXT_SOURCE_CATEGORIES: Record<ContextSourceId, ContextInjectionCategory> = {
  [CONTEXT_SOURCES.identity]: "narrative",
  [CONTEXT_SOURCES.deliberationMemory]: "narrative",
  [CONTEXT_SOURCES.optimizationContinuity]: "narrative",
  [CONTEXT_SOURCES.skillPromotionDrafts]: "narrative",
  [CONTEXT_SOURCES.runtimeStatus]: "narrative",
  [CONTEXT_SOURCES.taskState]: "narrative",
  [CONTEXT_SOURCES.toolOutputsDistilled]: "narrative",
  [CONTEXT_SOURCES.projectionWorking]: "narrative",
};
