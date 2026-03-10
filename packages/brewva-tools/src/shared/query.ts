export function tokenizeSearchTerms(
  value: string,
  options: {
    minLength?: number;
  } = {},
): string[] {
  const minLength = Math.max(1, Math.floor(options.minLength ?? 2));
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= minLength),
    ),
  ];
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
