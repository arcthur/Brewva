import type { SkillsIndexEntry } from "../types.js";

export interface SkillChainPlannerInput {
  primary: SkillsIndexEntry;
  index: SkillsIndexEntry[];
  availableOutputs?: Iterable<string>;
}

export interface SkillChainPlannerResult {
  chain: string[];
  prerequisites: string[];
  unresolvedConsumes: string[];
}

const COST_RANK: Record<SkillsIndexEntry["costHint"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const STABILITY_RANK: Record<SkillsIndexEntry["stability"], number> = {
  stable: 0,
  experimental: 1,
  deprecated: 2,
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveCostHint(value: unknown): SkillsIndexEntry["costHint"] {
  if (value === "low" || value === "high" || value === "medium") {
    return value;
  }
  return "medium";
}

function resolveStability(value: unknown): SkillsIndexEntry["stability"] {
  if (value === "experimental" || value === "deprecated" || value === "stable") {
    return value;
  }
  return "stable";
}

function hasOutput(entry: SkillsIndexEntry, outputName: string): boolean {
  return normalizeStringArray(entry.outputs).some((value) => value === outputName);
}

function resolveComposableRank(primary: SkillsIndexEntry, candidate: SkillsIndexEntry): number {
  const primaryAllows = normalizeStringArray(primary.composableWith).includes(candidate.name);
  if (primaryAllows) return 0;
  const candidateAllows = normalizeStringArray(candidate.composableWith).includes(primary.name);
  if (candidateAllows) return 1;
  return 2;
}

function compareProducer(
  primary: SkillsIndexEntry,
  left: SkillsIndexEntry,
  right: SkillsIndexEntry,
): number {
  const composableRankDiff =
    resolveComposableRank(primary, left) - resolveComposableRank(primary, right);
  if (composableRankDiff !== 0) return composableRankDiff;

  const costDiff =
    COST_RANK[resolveCostHint(left.costHint)] - COST_RANK[resolveCostHint(right.costHint)];
  if (costDiff !== 0) return costDiff;

  const stabilityDiff =
    STABILITY_RANK[resolveStability(left.stability)] -
    STABILITY_RANK[resolveStability(right.stability)];
  if (stabilityDiff !== 0) return stabilityDiff;

  return left.name.localeCompare(right.name);
}

function normalizeOutputSet(input?: Iterable<string>): Set<string> {
  const out = new Set<string>();
  if (!input) return out;
  for (const rawValue of input) {
    const normalized = rawValue.trim();
    if (!normalized) continue;
    out.add(normalized);
  }
  return out;
}

export function planSkillChain(input: SkillChainPlannerInput): SkillChainPlannerResult {
  const availableOutputs = normalizeOutputSet(input.availableOutputs);
  const prerequisites: string[] = [];
  const unresolvedConsumes: string[] = [];
  const plannedSkills = new Set<string>([input.primary.name]);

  for (const consumedOutput of normalizeStringArray(input.primary.consumes)) {
    const normalizedConsume = consumedOutput.trim();
    if (!normalizedConsume) continue;
    if (availableOutputs.has(normalizedConsume)) continue;

    const producers = input.index
      .filter((entry) => entry.name !== input.primary.name)
      .filter((entry) => hasOutput(entry, normalizedConsume))
      .toSorted((left, right) => compareProducer(input.primary, left, right));
    const producer = producers[0];
    if (!producer) {
      unresolvedConsumes.push(normalizedConsume);
      continue;
    }

    if (!plannedSkills.has(producer.name)) {
      prerequisites.push(producer.name);
      plannedSkills.add(producer.name);
    }
    for (const producedOutput of normalizeStringArray(producer.outputs)) {
      const normalizedProduced = producedOutput.trim();
      if (!normalizedProduced) continue;
      availableOutputs.add(normalizedProduced);
    }
  }

  return {
    chain: [...prerequisites, input.primary.name],
    prerequisites,
    unresolvedConsumes,
  };
}
