const LEXICAL_WORD_RE = /[\p{L}\p{N}_]+/gu;

export type SparseLexicalVector = Map<number, number>;

export function tokenizeLexicalText(text: string): string[] {
  const matches = text.toLowerCase().match(LEXICAL_WORD_RE);
  if (!matches) return [];
  return matches.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function buildHashedBagOfWordsEmbedding(
  text: string,
  dimensions: number,
): SparseLexicalVector {
  const normalizedDimensions = Math.max(1, Math.floor(dimensions));
  const counts = new Map<number, number>();
  const tokens = tokenizeLexicalText(text);
  if (tokens.length === 0) return counts;
  for (const token of tokens) {
    const bucket = fnv1a32(token) % normalizedDimensions;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let norm = 0;
  for (const value of counts.values()) {
    norm += value * value;
  }
  if (norm <= 0) return new Map();
  const scale = Math.sqrt(norm);
  const normalized = new Map<number, number>();
  for (const [bucket, value] of counts.entries()) {
    normalized.set(bucket, value / scale);
  }
  return normalized;
}

export function cosineSimilaritySparse(
  left: SparseLexicalVector,
  right: SparseLexicalVector,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  const iterateLeft = left.size <= right.size;
  const source = iterateLeft ? left : right;
  const target = iterateLeft ? right : left;
  let dot = 0;
  for (const [bucket, value] of source.entries()) {
    dot += value * (target.get(bucket) ?? 0);
  }
  return dot;
}
