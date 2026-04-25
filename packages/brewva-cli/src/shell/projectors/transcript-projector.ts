import type { BrewvaPromptSessionEvent } from "@brewva/brewva-substrate";
import {
  extractMessageError,
  readAssistantMessageEventPartial,
  readMessageRole,
  readMessageStopReason,
  readToolResultMessage,
} from "../../message-content.js";
import type { ShellCommitOptions } from "../shell-actions.js";
import type { CliShellAction } from "../state/index.js";
import {
  buildSeedTranscriptMessages,
  buildTextTranscriptMessage,
  buildTranscriptMessageFromMessage,
  upsertToolExecutionIntoTranscriptMessages,
  type CliShellTranscriptMessage,
} from "../transcript.js";
import type { CliShellUiPort } from "../types.js";

export interface ShellTranscriptProjectorContext {
  getMessages(): readonly CliShellTranscriptMessage[];
  getSessionId(): string;
  getTranscriptSeed(): unknown[];
  setMessages(messages: readonly CliShellTranscriptMessage[]): void;
  commit(action: CliShellAction, options?: ShellCommitOptions): void;
  getUi(): CliShellUiPort;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toolResultStatus(input: { result?: unknown; isError?: boolean }): "completed" | "error" {
  if (input.isError === true) {
    return "error";
  }
  const details = asRecord(asRecord(input.result)?.details);
  return details?.verdict === "fail" ? "error" : "completed";
}

export class ShellTranscriptProjector {
  #assistantEntryId: string | undefined;
  #correctionTranscriptMarkerSequence = 0;
  readonly #correctionTranscriptMarkersBySessionId = new Map<string, CliShellTranscriptMessage>();

  constructor(private readonly context: ShellTranscriptProjectorContext) {}

  resetAssistantDraft(): void {
    this.#assistantEntryId = undefined;
  }

  clearCorrectionMarker(sessionId: string): void {
    this.#correctionTranscriptMarkersBySessionId.delete(sessionId);
  }

  setCorrectionMarker(text: string): void {
    const sessionId = this.context.getSessionId();
    const message = buildTextTranscriptMessage({
      id: `correction:${sessionId}:${++this.#correctionTranscriptMarkerSequence}`,
      role: "custom",
      text,
    });
    if (!message) {
      return;
    }
    this.#correctionTranscriptMarkersBySessionId.set(sessionId, message);
  }

  buildMessagesFromSession(): CliShellTranscriptMessage[] {
    const messages = buildSeedTranscriptMessages(this.context.getTranscriptSeed());
    const correctionMarker = this.#correctionTranscriptMarkersBySessionId.get(
      this.context.getSessionId(),
    );
    return correctionMarker ? [...messages, correctionMarker] : messages;
  }

  refreshFromSession(): void {
    this.replaceMessages(this.buildMessagesFromSession());
  }

  appendMessage(message: CliShellTranscriptMessage | null): void {
    if (!message) {
      return;
    }
    this.replaceMessages([...this.context.getMessages(), message]);
  }

  handleSessionEvent(event: BrewvaPromptSessionEvent): void {
    if (event.type === "message_update") {
      const assistantPartialMessage =
        readMessageRole(event.message) === "assistant"
          ? event.message
          : readMessageRole(readAssistantMessageEventPartial(event.assistantMessageEvent)) ===
              "assistant"
            ? readAssistantMessageEventPartial(event.assistantMessageEvent)
            : undefined;
      if (assistantPartialMessage) {
        this.upsertAssistantMessage(assistantPartialMessage, "streaming");
        return;
      }

      const delta = asRecord(event.assistantMessageEvent)?.delta;
      if (typeof delta === "string" && delta.length > 0) {
        const id = this.#assistantEntryId ?? `assistant:${Date.now()}`;
        this.#assistantEntryId = id;
        this.upsertMessage(
          buildTextTranscriptMessage({
            id,
            role: "assistant",
            text: `${this.readText(this.findMessage(id))}${delta}`,
            renderMode: "streaming",
          }),
        );
      }
      return;
    }

    if (event.type === "message_end") {
      const role = readMessageRole(event.message);
      const errorMessage =
        role === "assistant" && readMessageStopReason(event.message) === "error"
          ? extractMessageError(event.message)
          : undefined;
      if (errorMessage) {
        this.context.getUi().notify(errorMessage, "error");
      }

      const toolResult = readToolResultMessage(event.message);
      if (toolResult) {
        this.upsertToolExecution({
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          result: toolResult,
          status: toolResultStatus({ result: toolResult, isError: toolResult.isError }),
          renderMode: "stable",
          fallbackMessageId: `tool:result:${toolResult.toolCallId}`,
        });
        return;
      }

      if (role === "assistant") {
        if (asRecord(event.message)?.display === false) {
          if (this.#assistantEntryId) {
            this.removeMessage(this.#assistantEntryId);
          }
          this.#assistantEntryId = undefined;
          return;
        }
        if (this.#assistantEntryId) {
          this.upsertAssistantMessage(event.message, "stable");
          this.#assistantEntryId = undefined;
          return;
        }
        this.appendMessage(
          buildTranscriptMessageFromMessage(event.message, {
            id: `assistant:end:${Date.now()}`,
            renderMode: "stable",
          }),
        );
        this.#assistantEntryId = undefined;
        return;
      }

      if (role === "user") {
        this.#assistantEntryId = undefined;
        return;
      }

      this.appendMessage(
        buildTranscriptMessageFromMessage(event.message, {
          id: `${role ?? "message"}:end:${Date.now()}`,
          renderMode: "stable",
        }),
      );
      this.#assistantEntryId = undefined;
      return;
    }

    if (event.type === "tool_execution_start") {
      this.upsertToolExecution({
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        args: event.args,
        status: "running",
        renderMode: "streaming",
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      this.upsertToolExecution({
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        args: event.args,
        partialResult: event.partialResult,
        status: "running",
        renderMode: "streaming",
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      this.upsertToolExecution({
        toolCallId,
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        result: event.result,
        status: toolResultStatus({ result: event.result, isError: event.isError === true }),
        renderMode: "stable",
        fallbackMessageId: toolCallId ? `tool:end:${toolCallId}` : undefined,
      });
      return;
    }

    if (event.type === "tool_execution_phase_change") {
      this.upsertToolExecution({
        toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
        toolName: typeof event.toolName === "string" ? event.toolName : undefined,
        args: event.args,
        phase: typeof event.phase === "string" ? event.phase : undefined,
        status: event.phase === "cleanup" ? "completed" : "running",
        renderMode: "streaming",
      });
      return;
    }

    if (event.type === "session_phase_change") {
      const phase = asRecord(event.phase);
      this.context.commit({
        type: "status.set",
        key: "phase",
        text: typeof phase?.kind === "string" ? phase.kind : undefined,
      });
      return;
    }

    if (event.type === "context_state_change") {
      const contextState = asRecord(event.state);
      this.context.commit({
        type: "status.set",
        key: "pressure",
        text:
          typeof contextState?.budgetPressure === "string"
            ? contextState.budgetPressure
            : undefined,
      });
    }
  }

  private replaceMessages(messages: readonly CliShellTranscriptMessage[]): void {
    this.context.setMessages([...messages]);
  }

  private findMessage(id: string): CliShellTranscriptMessage | undefined {
    return this.context.getMessages().find((message) => message.id === id);
  }

  private removeMessage(id: string): void {
    const current = this.context.getMessages();
    const nextMessages = current.filter((message) => message.id !== id);
    if (nextMessages.length === current.length) {
      return;
    }
    this.replaceMessages(nextMessages);
  }

  private upsertMessage(message: CliShellTranscriptMessage | null): void {
    if (!message) {
      return;
    }
    const current = this.context.getMessages();
    const existingIndex = current.findIndex((candidate) => candidate.id === message.id);
    if (existingIndex < 0) {
      this.appendMessage(message);
      return;
    }
    this.replaceMessages([
      ...current.slice(0, existingIndex),
      message,
      ...current.slice(existingIndex + 1),
    ]);
  }

  private readText(message: CliShellTranscriptMessage | undefined): string {
    if (!message) {
      return "";
    }
    return message.parts
      .filter(
        (part): part is Extract<CliShellTranscriptMessage["parts"][number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("");
  }

  private upsertAssistantMessage(message: unknown, renderMode: "stable" | "streaming"): void {
    const id = this.#assistantEntryId ?? `assistant:${Date.now()}`;
    this.#assistantEntryId = id;
    const nextMessage = buildTranscriptMessageFromMessage(message, {
      id,
      renderMode,
      previousMessage: this.findMessage(id),
    });
    this.upsertMessage(nextMessage);
  }

  private upsertToolExecution(update: {
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    phase?: string;
    partialResult?: unknown;
    result?: unknown;
    status?: "pending" | "running" | "completed" | "error";
    renderMode?: "stable" | "streaming";
    fallbackMessageId?: string;
  }): void {
    if (typeof update.toolCallId !== "string" || update.toolCallId.length === 0) {
      return;
    }
    this.replaceMessages(
      upsertToolExecutionIntoTranscriptMessages(this.context.getMessages(), {
        toolCallId: update.toolCallId,
        toolName: update.toolName,
        args: update.args,
        phase: update.phase,
        partialResult: update.partialResult,
        result: update.result,
        status: update.status,
        renderMode: update.renderMode,
        fallbackMessageId: update.fallbackMessageId,
      }),
    );
  }
}
