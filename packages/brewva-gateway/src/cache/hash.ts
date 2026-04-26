const REDACTED_KEY_PATTERN = /^(api[_-]?key|authorization|auth|token|secret|password)$/i;

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStable(value));
}

export function stableHash(value: unknown): string {
  const input = typeof value === "string" ? value : stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeStable);
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    output[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : normalizeStable(value[key]);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
