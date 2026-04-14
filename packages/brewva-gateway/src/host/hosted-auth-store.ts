import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveHostedConfigValue } from "./hosted-config-value.js";
import { getHostedEnvApiKey } from "./hosted-provider-helpers.js";

const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_ISSUER = "https://auth.openai.com";

export type HostedAuthCredential =
  | {
      type: "api_key";
      key: string;
    }
  | ({
      type: "oauth";
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      access?: string;
      refresh?: string;
      expires?: number;
    } & Record<string, unknown>);

type HostedAuthStorageData = Record<string, HostedAuthCredential>;

interface ResolvedOAuthCredential {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function refreshOpenAICodexAccessToken(
  refreshToken: string,
): Promise<Required<Pick<ResolvedOAuthCredential, "accessToken">> & ResolvedOAuthCredential> {
  const response = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OPENAI_OAUTH_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  const nextAccessToken = readString(payload.access_token);
  if (!nextAccessToken) {
    throw new Error("Token refresh response was missing access_token.");
  }

  const expiresInSeconds = readFiniteNumber(payload.expires_in);
  return {
    accessToken: nextAccessToken,
    refreshToken: readString(payload.refresh_token),
    expiresAt:
      typeof expiresInSeconds === "number"
        ? Date.now() + Math.max(0, expiresInSeconds) * 1000
        : undefined,
  };
}

export class HostedAuthStore {
  readonly #authPath: string | undefined;
  #data: HostedAuthStorageData = {};
  #fallbackResolver?: (provider: string) => string | undefined;
  readonly #runtimeOverrides = new Map<string, string>();

  private constructor(authPath?: string, initialData?: HostedAuthStorageData) {
    this.#authPath = authPath;
    if (initialData) {
      this.#data = { ...initialData };
    } else {
      this.reload();
    }
  }

  static create(authPath: string): HostedAuthStore {
    return new HostedAuthStore(authPath);
  }

  static inMemory(data: HostedAuthStorageData = {}): HostedAuthStore {
    return new HostedAuthStore(undefined, data);
  }

  setFallbackResolver(resolver: (provider: string) => string | undefined): void {
    this.#fallbackResolver = resolver;
  }

  setRuntimeApiKey(provider: string, apiKey: string): void {
    this.#runtimeOverrides.set(provider, apiKey);
  }

  get(provider: string): HostedAuthCredential | undefined {
    return this.#data[provider];
  }

  hasAuth(provider: string): boolean {
    return (
      this.#runtimeOverrides.has(provider) ||
      this.#data[provider] !== undefined ||
      getHostedEnvApiKey(provider) !== undefined ||
      this.#fallbackResolver?.(provider) !== undefined
    );
  }

  reload(): void {
    if (!this.#authPath || !existsSync(this.#authPath)) {
      this.#data = {};
      return;
    }
    try {
      this.#data = JSON.parse(readFileSync(this.#authPath, "utf8")) as HostedAuthStorageData;
    } catch {
      this.#data = {};
    }
  }

  async getApiKey(
    provider: string,
    options?: { includeFallback?: boolean },
  ): Promise<string | undefined> {
    const runtimeKey = this.#runtimeOverrides.get(provider);
    if (runtimeKey) {
      return runtimeKey;
    }

    const credential = this.#data[provider];
    if (credential?.type === "api_key") {
      return resolveHostedConfigValue(credential.key);
    }
    if (credential?.type === "oauth") {
      return this.resolveOAuthAccessToken(provider, credential);
    }

    const envKey = getHostedEnvApiKey(provider);
    if (envKey) {
      return envKey;
    }

    if (options?.includeFallback !== false) {
      return this.#fallbackResolver?.(provider);
    }
    return undefined;
  }

  private async resolveOAuthAccessToken(
    provider: string,
    credential: Extract<HostedAuthCredential, { type: "oauth" }>,
  ): Promise<string | undefined> {
    const accessToken = readString(credential.accessToken) ?? readString(credential.access);
    const refreshToken = readString(credential.refreshToken) ?? readString(credential.refresh);
    const expiresAt =
      readFiniteNumber(credential.expiresAt) ?? readFiniteNumber(credential.expires);

    if (accessToken && (!expiresAt || expiresAt > Date.now())) {
      return accessToken;
    }

    if (provider !== "openai-codex" || !refreshToken) {
      return accessToken;
    }

    const refreshed = await refreshOpenAICodexAccessToken(refreshToken);
    const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
    const nextCredential: Extract<HostedAuthCredential, { type: "oauth" }> = {
      ...credential,
      type: "oauth",
      accessToken: refreshed.accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: refreshed.expiresAt,
      access: refreshed.accessToken,
      refresh: nextRefreshToken,
      expires: refreshed.expiresAt,
    };
    this.#data[provider] = nextCredential;
    this.persist();
    return refreshed.accessToken;
  }

  set(provider: string, credential: HostedAuthCredential): void {
    this.#data[provider] = credential;
    this.persist();
  }

  private persist(): void {
    if (!this.#authPath) {
      return;
    }
    mkdirSync(dirname(this.#authPath), { recursive: true });
    writeFileSync(this.#authPath, JSON.stringify(this.#data, null, 2), "utf8");
  }
}
