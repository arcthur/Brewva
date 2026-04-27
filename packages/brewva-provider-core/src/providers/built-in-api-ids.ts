export const BUILT_IN_API_PROVIDER_APIS = [
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "google-gemini-cli",
] as const;

export type BuiltInApiProviderApi = (typeof BUILT_IN_API_PROVIDER_APIS)[number];
