import type {
  SkillSelection,
  SkillSelectorSemanticFallbackConfig,
  SkillTriggerNegativeRule,
  SkillTriggerPolicy,
  SkillsIndexEntry,
} from "../types.js";
import { buildHashedBagOfWordsEmbedding, cosineSimilaritySparse } from "../utils/lexical-vector.js";

const WORD_RE = /[\p{L}\p{N}_-]+/gu;
const TERM_CHAR_RE = /[\p{L}\p{N}_-]/u;
const SENTENCE_BOUNDARY_RE = /[.!?。！？\n]/u;
const MAX_INTENT_WINDOW_TOKENS = 24;
const IMPERATIVE_PREFIXES = [
  "please",
  "can you",
  "could you",
  "help me",
  "i need to",
  "i want to",
  "i'd like to",
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "use",
  "when",
  "with",
]);

const INTENT_MATCH_SCORE = 8;
const INTENT_BODY_MATCH_SCORE = 4;
const TOPIC_MATCH_SCORE = 3;
const PHRASE_MATCH_SCORE = 6;
const NAME_MATCH_SCORE = 7;
const TAG_MATCH_SCORE = 4;
const DESCRIPTION_MATCH_SCORE = 1;
const ANTI_TAG_PENALTY = 3;
const INTENT_NEGATIVE_PENALTY = 5;
const TOPIC_NEGATIVE_PENALTY = 2;
const MAX_DESCRIPTION_MATCHES = 3;
const DEFAULT_SEMANTIC_FALLBACK: SkillSelectorSemanticFallbackConfig = {
  enabled: true,
  lexicalBypassScore: 8,
  minSimilarity: 0.22,
  embeddingDimensions: 384,
};
const SEMANTIC_TOKEN_ALIASES: Record<string, string[]> = {
  review: ["audit", "assess", "evaluate", "quality", "risk", "safety", "readiness"],
  audit: ["review", "assess", "evaluate", "quality", "risk", "safety"],
  assess: ["review", "audit", "evaluate", "quality", "risk"],
  evaluate: ["review", "audit", "assess", "quality", "risk"],
  ready: ["readiness", "review", "assess", "release", "ship", "deploy", "merge"],
  readiness: ["ready", "review", "assess", "release", "ship", "deploy", "merge"],
  ship: ["release", "deploy", "production", "readiness", "review", "merge"],
  release: ["ship", "deploy", "production", "readiness", "review", "merge"],
  deploy: ["ship", "release", "production", "readiness", "review"],
  merge: ["review", "risk", "safety", "readiness", "release"],
  safe: ["safety", "review", "risk"],
  safety: ["safe", "review", "risk"],
};
const EMPTY_TRIGGER_POLICY: SkillTriggerPolicy = {
  intents: [],
  topics: [],
  phrases: [],
  negatives: [],
};

interface PromptRegions {
  intentTokens: string[];
  intentText: string;
  bodyTokens: string[];
  bodyText: string;
  allTokens: string[];
  allText: string;
}

interface NormalizedSemanticFallbackConfig extends SkillSelectorSemanticFallbackConfig {}

export interface SkillSelectorOptions {
  semanticFallback?: Partial<SkillSelectorSemanticFallbackConfig>;
}

function isAsciiWord(token: string): boolean {
  return /^[a-z0-9_-]+$/u.test(token);
}

function tokenize(input: string): string[] {
  const rawTokens = input.toLowerCase().match(WORD_RE) ?? [];
  return rawTokens.filter((token) => {
    if (token.length === 0) return false;
    if (isAsciiWord(token)) return token.length >= 2;
    return true;
  });
}

function costWeight(costHint: SkillsIndexEntry["costHint"] | undefined): number {
  if (costHint === "low") return 1;
  if (costHint === "high") return -1;
  return 0;
}

function normalizeSemanticFallbackConfig(
  value: SkillSelectorOptions["semanticFallback"],
): NormalizedSemanticFallbackConfig {
  const candidate = value ?? {};
  return {
    enabled:
      typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : DEFAULT_SEMANTIC_FALLBACK.enabled,
    lexicalBypassScore:
      typeof candidate.lexicalBypassScore === "number" &&
      Number.isFinite(candidate.lexicalBypassScore)
        ? Math.max(0, candidate.lexicalBypassScore)
        : DEFAULT_SEMANTIC_FALLBACK.lexicalBypassScore,
    minSimilarity:
      typeof candidate.minSimilarity === "number" && Number.isFinite(candidate.minSimilarity)
        ? Math.max(0, Math.min(1, candidate.minSimilarity))
        : DEFAULT_SEMANTIC_FALLBACK.minSimilarity,
    embeddingDimensions:
      typeof candidate.embeddingDimensions === "number" &&
      Number.isFinite(candidate.embeddingDimensions)
        ? Math.max(64, Math.floor(candidate.embeddingDimensions))
        : DEFAULT_SEMANTIC_FALLBACK.embeddingDimensions,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeNegativeRules(value: unknown): SkillTriggerNegativeRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      scope: item.scope === "intent" ? ("intent" as const) : ("topic" as const),
      terms: normalizeStringArray(item.terms),
    }))
    .filter((rule) => rule.terms.length > 0);
}

function readEntryTriggers(entry: SkillsIndexEntry): SkillTriggerPolicy {
  const raw = entry.triggers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_TRIGGER_POLICY;
  }
  const rawRecord = raw as unknown as Record<string, unknown>;
  return {
    intents: normalizeStringArray(rawRecord.intents),
    topics: normalizeStringArray(rawRecord.topics),
    phrases: normalizeStringArray(rawRecord.phrases),
    negatives: normalizeNegativeRules(rawRecord.negatives),
  };
}

function hasBoundedSubstring(text: string, term: string): boolean {
  if (term.length === 0) return false;
  let offset = text.indexOf(term);
  while (offset !== -1) {
    const before = offset > 0 ? text[offset - 1] : undefined;
    const afterOffset = offset + term.length;
    const after = afterOffset < text.length ? text[afterOffset] : undefined;
    const beforeBounded = before === undefined || !TERM_CHAR_RE.test(before);
    const afterBounded = after === undefined || !TERM_CHAR_RE.test(after);
    if (beforeBounded && afterBounded) {
      return true;
    }
    offset = text.indexOf(term, offset + 1);
  }
  return false;
}

function hasTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function trimLeadingImperativePrefix(text: string): string {
  const trimmed = text.trimStart();
  for (const prefix of IMPERATIVE_PREFIXES) {
    if (!trimmed.startsWith(prefix)) continue;
    let rest = trimmed.slice(prefix.length).trimStart();
    rest = rest.replace(/^[,:;-]+\s*/u, "");
    return rest;
  }
  return trimmed;
}

function extractPromptRegions(message: string): PromptRegions {
  const allText = message.toLowerCase().trim();
  const allTokens = tokenize(allText);
  if (allText.length === 0) {
    return {
      intentTokens: [],
      intentText: "",
      bodyTokens: [],
      bodyText: "",
      allTokens,
      allText,
    };
  }

  const sentenceBoundary = allText.search(SENTENCE_BOUNDARY_RE);
  const sentenceEnd = sentenceBoundary >= 0 ? sentenceBoundary + 1 : allText.length;
  const rawIntent = allText.slice(0, sentenceEnd);
  const intentText = trimLeadingImperativePrefix(rawIntent);
  const rawBodyText = allText.slice(sentenceEnd).trim();
  const intentTokens = tokenize(intentText).slice(0, MAX_INTENT_WINDOW_TOKENS);
  const bodyText = rawBodyText;
  const bodyTokens = tokenize(bodyText);

  return {
    intentTokens,
    intentText,
    bodyTokens,
    bodyText,
    allTokens,
    allText,
  };
}

function descriptionSignalTokens(description: string): string[] {
  const unique = new Set<string>();
  for (const token of tokenize(description)) {
    if (STOP_WORDS.has(token)) continue;
    if (isAsciiWord(token) && token.length < 3) continue;
    unique.add(token);
    if (unique.size >= 16) break;
  }
  return [...unique];
}

function matchesTerm(input: {
  term: string;
  text: string;
  tokenList: string[];
  tokenSet: Set<string>;
}): boolean {
  const normalized = input.term.trim().toLowerCase();
  if (!normalized) return false;

  const termTokens = tokenize(normalized);
  if (termTokens.length === 0) return false;

  if (termTokens.length === 1) {
    const token = termTokens[0]!;
    if (input.tokenSet.has(token)) return true;
    if (!isAsciiWord(token)) return input.text.includes(token);
    if (token.length < 3) return false;
    return hasBoundedSubstring(input.text, token);
  }

  return hasTokenSequence(input.tokenList, termTokens);
}

function hasExplicitTriggers(entry: SkillsIndexEntry): boolean {
  const triggers = readEntryTriggers(entry);
  return (
    triggers.intents.length > 0 ||
    triggers.topics.length > 0 ||
    triggers.phrases.length > 0 ||
    triggers.negatives.length > 0
  );
}

function resolveEffectiveTriggers(entry: SkillsIndexEntry): SkillTriggerPolicy {
  const explicitTriggers = readEntryTriggers(entry);
  if (hasExplicitTriggers(entry)) {
    return explicitTriggers;
  }
  const tags = normalizeStringArray(entry.tags);
  const description = typeof entry.description === "string" ? entry.description : "";
  return {
    intents: [entry.name, ...tags],
    topics: descriptionSignalTokens(description),
    phrases: [],
    negatives: [],
  };
}

function stemSemanticToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("tion")) return token.slice(0, -4);
  if (token.endsWith("sion")) return token.slice(0, -4);
  if (token.endsWith("ment")) return token.slice(0, -4);
  if (token.endsWith("ness")) return token.slice(0, -4);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function semanticAliasTokens(text: string): string[] {
  const expanded = new Set<string>();
  for (const rawToken of tokenize(text)) {
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;
    const stemmed = stemSemanticToken(token);
    const aliases = SEMANTIC_TOKEN_ALIASES[token] ?? SEMANTIC_TOKEN_ALIASES[stemmed];
    if (!aliases) continue;
    for (const alias of aliases) {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) continue;
      expanded.add(normalizedAlias);
    }
  }
  return [...expanded];
}

function augmentSemanticText(text: string): string {
  const normalized = text.trim();
  if (!normalized) return normalized;
  const aliases = semanticAliasTokens(normalized);
  if (aliases.length === 0) return normalized;
  return `${normalized}\n${aliases.join(" ")}`;
}

function semanticScoreFromSimilarity(similarity: number, lexicalBypassScore: number): number {
  const cap = Math.max(4, Math.round(lexicalBypassScore));
  return Math.max(1, Math.round(similarity * cap));
}

function roundSimilarityReason(similarity: number): string {
  return (Math.round(similarity * 1000) / 1000).toFixed(3);
}

function rankAndTake(scored: SkillSelection[], k: number): SkillSelection[] {
  return scored
    .toSorted((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(1, k));
}

function buildSemanticSkillText(entry: SkillsIndexEntry, triggers: SkillTriggerPolicy): string {
  const parts = [
    entry.name,
    entry.description,
    ...normalizeStringArray(entry.tags),
    ...normalizeStringArray(entry.outputs),
    ...normalizeStringArray(entry.consumes),
    ...triggers.intents,
    ...triggers.topics,
    ...triggers.phrases,
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parts.join("\n");
}

function applyTriggerNegativePenalties(input: {
  triggers: SkillTriggerPolicy;
  regions: PromptRegions;
  intentSet: Set<string>;
  allSet: Set<string>;
  reasons: string[];
}): number {
  let penalty = 0;
  for (const rule of input.triggers.negatives) {
    for (const term of rule.terms) {
      if (
        rule.scope === "intent" &&
        matchesTerm({
          term,
          text: input.regions.intentText,
          tokenList: input.regions.intentTokens,
          tokenSet: input.intentSet,
        })
      ) {
        penalty += INTENT_NEGATIVE_PENALTY;
        input.reasons.push(`neg-intent:${term}`);
        continue;
      }
      if (
        rule.scope === "topic" &&
        matchesTerm({
          term,
          text: input.regions.allText,
          tokenList: input.regions.allTokens,
          tokenSet: input.allSet,
        })
      ) {
        penalty += TOPIC_NEGATIVE_PENALTY;
        input.reasons.push(`neg-topic:${term}`);
      }
    }
  }
  return penalty;
}

function applyAntiTagPenalties(input: {
  antiTags: string[];
  regions: PromptRegions;
  allSet: Set<string>;
  reasons: string[];
}): number {
  let penalty = 0;
  for (const antiTag of new Set(input.antiTags.map((value) => value.trim()).filter(Boolean))) {
    if (
      !matchesTerm({
        term: antiTag,
        text: input.regions.allText,
        tokenList: input.regions.allTokens,
        tokenSet: input.allSet,
      })
    ) {
      continue;
    }
    penalty += ANTI_TAG_PENALTY;
    input.reasons.push(`anti:${antiTag}`);
  }
  return penalty;
}

export function selectTopKSkills(
  message: string,
  index: SkillsIndexEntry[],
  k: number,
  options: SkillSelectorOptions = {},
): SkillSelection[] {
  const regions = extractPromptRegions(message);
  const intentSet = new Set(regions.intentTokens);
  const bodySet = new Set(regions.bodyTokens);
  const allSet = new Set(regions.allTokens);
  const semanticFallback = normalizeSemanticFallbackConfig(options.semanticFallback);

  const scored: SkillSelection[] = [];

  for (const entry of index) {
    let score = 0;
    let positiveSignals = 0;
    const reasons: string[] = [];
    const tags = normalizeStringArray(entry.tags);
    const antiTags = normalizeStringArray(entry.antiTags);
    const explicitTriggers = readEntryTriggers(entry);
    const triggers = resolveEffectiveTriggers(entry);
    const explicitNegatives = explicitTriggers.negatives.length > 0;

    for (const intent of new Set(triggers.intents.map((value) => value.trim()).filter(Boolean))) {
      if (
        matchesTerm({
          term: intent,
          text: regions.intentText,
          tokenList: regions.intentTokens,
          tokenSet: intentSet,
        })
      ) {
        score += INTENT_MATCH_SCORE;
        positiveSignals += 1;
        reasons.push(`intent:${intent}`);
        continue;
      }
      if (
        matchesTerm({
          term: intent,
          text: regions.bodyText,
          tokenList: regions.bodyTokens,
          tokenSet: bodySet,
        })
      ) {
        score += INTENT_BODY_MATCH_SCORE;
        positiveSignals += 1;
        reasons.push(`intent-body:${intent}`);
      }
    }

    for (const topic of new Set(triggers.topics.map((value) => value.trim()).filter(Boolean))) {
      if (
        !matchesTerm({
          term: topic,
          text: regions.allText,
          tokenList: regions.allTokens,
          tokenSet: allSet,
        })
      ) {
        continue;
      }
      score += TOPIC_MATCH_SCORE;
      positiveSignals += 1;
      reasons.push(`topic:${topic}`);
    }

    for (const phrase of new Set(triggers.phrases.map((value) => value.trim()).filter(Boolean))) {
      const phraseTokens = tokenize(phrase);
      if (phraseTokens.length === 0) continue;
      if (!hasTokenSequence(regions.allTokens, phraseTokens)) continue;
      score += PHRASE_MATCH_SCORE;
      positiveSignals += 1;
      reasons.push(`phrase:${phrase}`);
    }

    score -= applyTriggerNegativePenalties({
      triggers,
      regions,
      intentSet,
      allSet,
      reasons,
    });

    if (
      matchesTerm({
        term: entry.name,
        text: regions.allText,
        tokenList: regions.allTokens,
        tokenSet: allSet,
      })
    ) {
      score += NAME_MATCH_SCORE;
      positiveSignals += 1;
      reasons.push("name-match");
    }

    for (const tag of new Set(tags.map((value) => value.trim()).filter(Boolean))) {
      if (
        !matchesTerm({
          term: tag,
          text: regions.allText,
          tokenList: regions.allTokens,
          tokenSet: allSet,
        })
      ) {
        continue;
      }
      score += TAG_MATCH_SCORE;
      positiveSignals += 1;
      reasons.push(`tag:${tag}`);
    }

    let descriptionMatches = 0;
    for (const token of descriptionSignalTokens(entry.description)) {
      if (allSet.has(token)) {
        descriptionMatches += 1;
      }
      if (descriptionMatches >= MAX_DESCRIPTION_MATCHES) {
        break;
      }
    }
    if (descriptionMatches > 0) {
      score += descriptionMatches * DESCRIPTION_MATCH_SCORE;
      positiveSignals += descriptionMatches;
      reasons.push(`description:${descriptionMatches}`);
    }

    if (positiveSignals === 0) {
      continue;
    }

    if (!explicitNegatives) {
      score -= applyAntiTagPenalties({
        antiTags,
        regions,
        allSet,
        reasons,
      });
    }

    score += costWeight(entry.costHint);
    if (score <= 0) {
      continue;
    }

    scored.push({
      name: entry.name,
      score,
      reason: reasons.length > 0 ? reasons.join(",") : "description-match",
    });
  }

  const lexicalTopScore = scored.reduce((best, entry) => Math.max(best, entry.score), 0);
  if (!semanticFallback.enabled || lexicalTopScore >= semanticFallback.lexicalBypassScore) {
    return rankAndTake(scored, k);
  }

  const semanticPromptText = augmentSemanticText(regions.allText);
  const promptEmbedding = buildHashedBagOfWordsEmbedding(
    semanticPromptText,
    semanticFallback.embeddingDimensions,
  );
  if (promptEmbedding.size === 0) {
    return rankAndTake(scored, k);
  }

  const combinedByName = new Map(scored.map((entry) => [entry.name, entry]));
  for (const entry of index) {
    const existing = combinedByName.get(entry.name);
    const explicitTriggers = readEntryTriggers(entry);
    const explicitNegatives = explicitTriggers.negatives.length > 0;
    const antiTags = normalizeStringArray(entry.antiTags);
    const triggers = resolveEffectiveTriggers(entry);
    const semanticSkillText = augmentSemanticText(buildSemanticSkillText(entry, triggers));
    if (!semanticSkillText) continue;
    const skillEmbedding = buildHashedBagOfWordsEmbedding(
      semanticSkillText,
      semanticFallback.embeddingDimensions,
    );
    if (skillEmbedding.size === 0) continue;
    const similarity = cosineSimilaritySparse(promptEmbedding, skillEmbedding);
    if (similarity < semanticFallback.minSimilarity) continue;
    const semanticReasons = [`semantic:${roundSimilarityReason(similarity)}`];
    let semanticScore = semanticScoreFromSimilarity(
      similarity,
      semanticFallback.lexicalBypassScore,
    );
    semanticScore -= applyTriggerNegativePenalties({
      triggers,
      regions,
      intentSet,
      allSet,
      reasons: semanticReasons,
    });
    if (!explicitNegatives) {
      semanticScore -= applyAntiTagPenalties({
        antiTags,
        regions,
        allSet,
        reasons: semanticReasons,
      });
    }
    semanticScore += costWeight(entry.costHint);
    if (semanticScore <= 0) continue;

    if (!existing) {
      combinedByName.set(entry.name, {
        name: entry.name,
        score: semanticScore,
        reason: semanticReasons.join(","),
      });
      continue;
    }
    if (semanticScore > existing.score) {
      combinedByName.set(entry.name, {
        name: entry.name,
        score: semanticScore,
        reason: `${existing.reason},${semanticReasons.join(",")}`,
      });
    }
  }

  return rankAndTake([...combinedByName.values()], k);
}
