import { describe, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  complete,
  getModel,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreamOptions,
} from "@brewva/brewva-provider-core";
import { resolveBrewvaAgentDir } from "@brewva/brewva-runtime";
import { hasProviderRateLimitText } from "../../helpers/cli.js";
import { runLive } from "../../helpers/live.js";
import { repoRoot } from "../../helpers/workspace.js";

const LIVE_MODEL_ID = process.env.BREWVA_LIVE_CACHE_MODEL || "gpt-5.4";
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_ISSUER = "https://auth.openai.com";
const CACHE_ANCHOR = Array.from(
  { length: 900 },
  (_, index) =>
    `cache-anchor-${String(index).padStart(4, "0")}: Preserve this deterministic prefix for provider prompt-cache live verification.`,
).join("\n");

const MODEL = getModel("openai-codex", LIVE_MODEL_ID as never) as Model<"openai-codex-responses">;

type CodexAuthCredential = {
  type?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  access?: unknown;
  refresh?: unknown;
  expires?: unknown;
};

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

async function refreshCodexAccessToken(
  authPath: string,
  credential: CodexAuthCredential,
): Promise<string | undefined> {
  const refreshToken = readString(credential.refreshToken) ?? readString(credential.refresh);
  if (!refreshToken) {
    return readString(credential.accessToken) ?? readString(credential.access);
  }

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
  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new Error("Token refresh response was missing access_token.");
  }

  const expiresInSeconds = readFiniteNumber(payload.expires_in);
  const nextCredential = {
    ...credential,
    type: "oauth",
    accessToken,
    refreshToken: readString(payload.refresh_token) ?? refreshToken,
    expiresAt:
      typeof expiresInSeconds === "number"
        ? Date.now() + Math.max(0, expiresInSeconds) * 1000
        : undefined,
  };
  const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
  raw["openai-codex"] = {
    ...nextCredential,
    access: nextCredential.accessToken,
    refresh: nextCredential.refreshToken,
    expires: nextCredential.expiresAt,
  };
  writeFileSync(authPath, JSON.stringify(raw, null, 2), "utf8");
  return accessToken;
}

async function readCodexAccessTokenFromAuthFile(authPath: string): Promise<string | undefined> {
  if (!existsSync(authPath)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
  const credential = raw["openai-codex"] as CodexAuthCredential | undefined;
  if (!credential || credential.type !== "oauth") {
    return undefined;
  }
  const accessToken = readString(credential.accessToken) ?? readString(credential.access);
  const expiresAt = readFiniteNumber(credential.expiresAt) ?? readFiniteNumber(credential.expires);
  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) {
    return accessToken;
  }
  return refreshCodexAccessToken(authPath, credential);
}

async function resolveCodexAccessToken(): Promise<string | undefined> {
  const explicit = process.env.OPENAI_CODEX_ACCESS_TOKEN || process.env.BREWVA_OPENAI_CODEX_TOKEN;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  for (const agentDir of [resolveBrewvaAgentDir(), join(repoRoot, ".brewva", "agent")]) {
    const token = await readCodexAccessTokenFromAuthFile(join(agentDir, "auth.json"));
    if (token) {
      return token;
    }
  }
  return undefined;
}

function formatProviderSkip(label: string, error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (
    hasProviderRateLimitText(message) ||
    /no api key|token refresh failed|failed to extract accountid|unauthorized|forbidden|usage limit/i.test(
      message,
    )
  ) {
    return `[${label}] skipped because provider auth/quota is unavailable: ${message}`;
  }
  return undefined;
}

function userMessage(text: string): Context["messages"][number] {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function messageText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

async function runCodexTurn(input: {
  apiKey: string;
  context: Context;
  sessionId: string;
  transport: "sse" | "websocket";
  previousResponseId?: string;
}): Promise<AssistantMessage> {
  const options: ProviderStreamOptions = {
    apiKey: input.apiKey,
    sessionId: input.sessionId,
    transport: input.transport,
    previousResponseId: input.previousResponseId,
    textVerbosity: "low",
    reasoningEffort: "low",
    reasoningSummary: "auto",
    cachePolicy: {
      retention: "short",
      writeMode: "readWrite",
      scope: "session",
      reason: "live_test",
    },
  };
  const message = await complete(MODEL, input.context, options);
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage || `Provider ended with ${message.stopReason}`);
  }
  return message;
}

describe("live: provider token cache", () => {
  runLive(
    "gpt-5.4 reports prompt cache reads after a stable Codex prefix is warmed",
    async () => {
      let apiKey: string | undefined;
      try {
        apiKey = await resolveCodexAccessToken();
      } catch (error) {
        const skipMessage = formatProviderSkip("token-cache.live auth", error);
        if (skipMessage) {
          console.warn(skipMessage);
          return;
        }
        throw error;
      }
      if (!apiKey) {
        console.warn("[token-cache.live] skipped because openai-codex auth is unavailable");
        return;
      }

      const sessionId = `cache-live-${randomUUID()}`;
      const systemPrompt = [
        "You are a cache verification responder.",
        "Follow the user's exact reply instruction and do not add extra text.",
        CACHE_ANCHOR,
      ].join("\n");

      let first: AssistantMessage;
      try {
        first = await runCodexTurn({
          apiKey,
          sessionId,
          transport: "sse",
          context: {
            systemPrompt,
            messages: [userMessage("Reply exactly: CACHE-LIVE-WARMED")],
          },
        });
      } catch (error) {
        const skipMessage = formatProviderSkip("token-cache.live warmup", error);
        if (skipMessage) {
          console.warn(skipMessage);
          return;
        }
        throw error;
      }
      expect(messageText(first)).toContain("CACHE-LIVE-WARMED");

      const cacheReadAttempts: AssistantMessage[] = [];
      for (const marker of ["CACHE-LIVE-HIT-1", "CACHE-LIVE-HIT-2"] as const) {
        try {
          const message = await runCodexTurn({
            apiKey,
            sessionId,
            transport: "sse",
            context: {
              systemPrompt,
              messages: [userMessage(`Reply exactly: ${marker}`)],
            },
          });
          cacheReadAttempts.push(message);
          if (message.usage.cacheRead > 0) {
            break;
          }
        } catch (error) {
          const skipMessage = formatProviderSkip(`token-cache.live ${marker}`, error);
          if (skipMessage) {
            console.warn(skipMessage);
            return;
          }
          throw error;
        }
      }

      expect(cacheReadAttempts.length).toBeGreaterThan(0);
      expect(
        Math.max(...cacheReadAttempts.map((message) => message.usage.cacheRead)),
      ).toBeGreaterThan(0);
    },
    180_000,
  );

  runLive(
    "gpt-5.4 accepts Codex websocket continuation with previous_response_id",
    async () => {
      let apiKey: string | undefined;
      try {
        apiKey = await resolveCodexAccessToken();
      } catch (error) {
        const skipMessage = formatProviderSkip("token-cache.live auth", error);
        if (skipMessage) {
          console.warn(skipMessage);
          return;
        }
        throw error;
      }
      if (!apiKey) {
        console.warn("[token-cache.live] skipped because openai-codex auth is unavailable");
        return;
      }

      const sessionId = `continuation-live-${randomUUID()}`;
      const systemPrompt = [
        "You are a Codex continuation verification responder.",
        "Reply with the exact marker requested by the latest user message.",
        CACHE_ANCHOR,
      ].join("\n");
      const firstUser = userMessage("Reply exactly: CONTINUATION-LIVE-ONE");

      let first: AssistantMessage;
      try {
        first = await runCodexTurn({
          apiKey,
          sessionId,
          transport: "websocket",
          context: {
            systemPrompt,
            messages: [firstUser],
          },
        });
      } catch (error) {
        const skipMessage = formatProviderSkip("token-cache.live websocket first turn", error);
        if (skipMessage) {
          console.warn(skipMessage);
          return;
        }
        throw error;
      }
      expect(first.responseId).toEqual(expect.any(String));
      expect(messageText(first)).toContain("CONTINUATION-LIVE-ONE");

      let second: AssistantMessage;
      try {
        second = await runCodexTurn({
          apiKey,
          sessionId,
          transport: "websocket",
          previousResponseId: first.responseId,
          context: {
            systemPrompt,
            messages: [firstUser, first, userMessage("Reply exactly: CONTINUATION-LIVE-TWO")],
          },
        });
      } catch (error) {
        const skipMessage = formatProviderSkip("token-cache.live websocket continuation", error);
        if (skipMessage) {
          console.warn(skipMessage);
          return;
        }
        throw error;
      }

      expect(second.responseId).toEqual(expect.any(String));
      expect(second.responseId).not.toBe(first.responseId);
      expect(messageText(second)).toContain("CONTINUATION-LIVE-TWO");
    },
    180_000,
  );
});
