import type { ApiProvider } from "../api-registry.js";
import type { Api, StreamOptions } from "../types.js";
import { getStandardBuiltInApiProviderRegistrations } from "./built-in-provider-loaders.js";

export function getBuiltInApiProviderRegistrations(): ApiProvider<Api, StreamOptions>[] {
  return getStandardBuiltInApiProviderRegistrations();
}
