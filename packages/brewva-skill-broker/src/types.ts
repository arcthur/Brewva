export const SKILL_PROMOTION_STATE_SCHEMA = "brewva.skill-promotion.v1" as const;

export const SKILL_PROMOTION_TARGET_KINDS = [
  "skill_patch",
  "new_skill",
  "project_rule",
  "agents_update",
  "docs_note",
] as const;

export type SkillPromotionTargetKind = (typeof SKILL_PROMOTION_TARGET_KINDS)[number];

export const SKILL_PROMOTION_STATUSES = ["draft", "approved", "rejected", "promoted"] as const;

export type SkillPromotionStatus = (typeof SKILL_PROMOTION_STATUSES)[number];

export interface SkillPromotionEvidenceRef {
  sessionId: string;
  eventId: string;
  eventType: string;
  timestamp: number;
}

export interface SkillPromotionTarget {
  kind: SkillPromotionTargetKind;
  pathHint: string;
  rationale: string;
}

export interface SkillPromotionReview {
  decision: "approve" | "reject" | "reopen";
  note?: string;
  reviewedAt: number;
}

export interface SkillPromotionMaterialization {
  materializedAt: number;
  directoryPath: string;
  primaryPath: string;
  format: "markdown_packet" | "skill_scaffold";
}

export interface SkillPromotionDraft {
  id: string;
  status: SkillPromotionStatus;
  title: string;
  summary: string;
  rationale: string;
  sourceSkillName: string;
  target: SkillPromotionTarget;
  repeatCount: number;
  confidenceScore: number;
  firstCapturedAt: number;
  lastValidatedAt: number;
  sessionIds: string[];
  evidence: SkillPromotionEvidenceRef[];
  tags: string[];
  proposalText: string;
  review?: SkillPromotionReview;
  promotion?: SkillPromotionMaterialization;
}

export interface SkillPromotionSessionDigest {
  sessionId: string;
  eventCount: number;
  lastEventAt: number;
}

export interface SkillPromotionState {
  schema: typeof SKILL_PROMOTION_STATE_SCHEMA;
  updatedAt: number;
  sessionDigests: SkillPromotionSessionDigest[];
  drafts: SkillPromotionDraft[];
}
