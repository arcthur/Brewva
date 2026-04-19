import { tokenizeSearchText } from "@brewva/brewva-search";

export function tokenizeSearchTerms(
  value: string,
  options: {
    minLength?: number;
  } = {},
): string[] {
  const minLength = Math.max(1, Math.floor(options.minLength ?? 2));
  return tokenizeSearchText(value, {
    minLength,
    includeCompoundSubtokens: false,
  });
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
