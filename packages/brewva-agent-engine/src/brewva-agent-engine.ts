import type { BrewvaRegisteredModel } from "@brewva/brewva-substrate";
import type {
  BrewvaAgentEngine,
  BrewvaAgentEngineAfterToolCallContext,
  BrewvaAgentEngineBeforeToolCallContext,
  BrewvaAgentEngineEvent,
  BrewvaAgentEngineMessage,
  BrewvaAgentEngineResolveRequestAuth,
  BrewvaAgentEngineStopAfterToolResults,
  BrewvaAgentEngineStreamFunction,
  BrewvaAgentEngineCachePolicy,
  BrewvaAgentEngineCacheRenderResult,
  BrewvaAgentEnginePayloadMetadata,
  BrewvaAgentEngineThinkingBudgets,
  BrewvaAgentEngineThinkingLevel,
  BrewvaAgentEngineTool,
  BrewvaAgentEngineTransport,
} from "./agent-engine-types.js";
import {
  runAgentLoop,
  type BrewvaAgentLoopConfig,
  type BrewvaAgentLoopContext,
} from "./agent-loop.js";
import { createHostedProviderStreamFunction } from "./provider-stream.js";

type QueueMode = "all" | "one-at-a-time";

interface MutableEngineState {
  systemPrompt: string;
  model: BrewvaRegisteredModel;
  thinkingLevel: BrewvaAgentEngineThinkingLevel | "off";
  tools: BrewvaAgentEngineTool[];
  messages: BrewvaAgentEngineMessage[];
  isStreaming: boolean;
  errorMessage?: string;
}

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

function excludeTransientAssistantFailure(
  message: BrewvaAgentEngineMessage,
): BrewvaAgentEngineMessage {
  if (
    message.role !== "assistant" ||
    (message.stopReason !== "error" && message.stopReason !== "aborted")
  ) {
    return message;
  }
  return {
    ...message,
    excludeFromContext: true,
  };
}

function excludeTransientFailureFromEvent(event: BrewvaAgentEngineEvent): BrewvaAgentEngineEvent {
  switch (event.type) {
    case "message_start":
    case "message_update":
    case "message_end":
      return {
        ...event,
        message: excludeTransientAssistantFailure(event.message),
      };
    case "turn_end":
      return {
        ...event,
        message: excludeTransientAssistantFailure(event.message),
      };
    case "agent_end":
      return {
        ...event,
        messages: event.messages.map(excludeTransientAssistantFailure),
      };
    default:
      return event;
  }
}

const EMPTY_MODEL: BrewvaRegisteredModel = {
  provider: "unknown",
  id: "unknown",
  name: "unknown",
  api: "openai-responses",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 0,
  maxTokens: 0,
};

class PendingMessageQueue {
  readonly #messages: BrewvaAgentEngineMessage[] = [];

  constructor(public mode: QueueMode) {}

  enqueue(message: BrewvaAgentEngineMessage): void {
    this.#messages.push(message);
  }

  hasItems(): boolean {
    return this.#messages.length > 0;
  }

  drain(): BrewvaAgentEngineMessage[] {
    if (this.mode === "all") {
      const drained = [...this.#messages];
      this.#messages.length = 0;
      return drained;
    }

    const first = this.#messages[0];
    if (!first) {
      return [];
    }
    this.#messages.splice(0, 1);
    return [first];
  }

  clear(): void {
    this.#messages.length = 0;
  }
}

class HostedBrewvaAgentEngine implements BrewvaAgentEngine {
  readonly #listeners = new Set<
    (
      event: BrewvaAgentEngineEvent,
    ) => Promise<BrewvaAgentEngineEvent | void> | BrewvaAgentEngineEvent | void
  >();
  readonly #queuedPromptQueue: PendingMessageQueue;
  readonly #followUpQueue: PendingMessageQueue;
  readonly #streamFn: BrewvaAgentEngineStreamFunction;
  readonly #resolveRequestAuth: BrewvaAgentEngineResolveRequestAuth | undefined;
  readonly #sessionId: string | undefined;
  readonly #cachePolicy: BrewvaAgentEngineCachePolicy | undefined;
  readonly #transport: BrewvaAgentEngineTransport;
  readonly #thinkingBudgets: BrewvaAgentEngineThinkingBudgets | undefined;
  readonly #maxRetryDelayMs: number | undefined;
  readonly #beforeToolCall:
    | ((
        input: BrewvaAgentEngineBeforeToolCallContext,
      ) => Promise<{ block?: boolean; reason?: string } | undefined>)
    | undefined;
  readonly #afterToolCall:
    | ((input: BrewvaAgentEngineAfterToolCallContext) => Promise<
        | {
            content: Array<
              { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
            >;
            details: unknown;
            isError?: boolean;
          }
        | undefined
      >)
    | undefined;
  readonly #onPayload: (
    payload: unknown,
    model: BrewvaRegisteredModel,
    metadata?: BrewvaAgentEnginePayloadMetadata,
  ) => Promise<unknown>;
  readonly #onCacheRender:
    | ((
        render: BrewvaAgentEngineCacheRenderResult,
        model: BrewvaRegisteredModel,
      ) => void | Promise<void>)
    | undefined;
  readonly #transformContext: (
    messages: BrewvaAgentEngineMessage[],
  ) => Promise<BrewvaAgentEngineMessage[]>;
  readonly #shouldStopAfterToolResults: BrewvaAgentEngineStopAfterToolResults | undefined;
  readonly #resolveFile:
    | ((
        part: import("./agent-engine-types.js").BrewvaAgentEngineFileContent,
        model: BrewvaRegisteredModel,
      ) => unknown)
    | undefined;

  #state: MutableEngineState;
  #activeRun: ActiveRun | undefined;
  #pendingSteer: string | undefined;

  constructor(input: {
    initialModel: BrewvaRegisteredModel | undefined;
    initialThinkingLevel: BrewvaAgentEngineThinkingLevel | "off";
    queueMode: QueueMode | undefined;
    followUpMode: QueueMode | undefined;
    transport: BrewvaAgentEngineTransport;
    thinkingBudgets: BrewvaAgentEngineThinkingBudgets | undefined;
    maxRetryDelayMs: number | undefined;
    sessionId: string | undefined;
    cachePolicy: BrewvaAgentEngineCachePolicy | undefined;
    beforeToolCall:
      | ((
          input: BrewvaAgentEngineBeforeToolCallContext,
        ) => Promise<{ block?: boolean; reason?: string } | undefined>)
      | undefined;
    afterToolCall:
      | ((input: BrewvaAgentEngineAfterToolCallContext) => Promise<
          | {
              content: Array<
                { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
              >;
              details: unknown;
              isError?: boolean;
            }
          | undefined
        >)
      | undefined;
    onPayload: (
      payload: unknown,
      model: BrewvaRegisteredModel,
      metadata?: BrewvaAgentEnginePayloadMetadata,
    ) => Promise<unknown>;
    onCacheRender:
      | ((
          render: BrewvaAgentEngineCacheRenderResult,
          model: BrewvaRegisteredModel,
        ) => void | Promise<void>)
      | undefined;
    transformContext: (messages: BrewvaAgentEngineMessage[]) => Promise<BrewvaAgentEngineMessage[]>;
    shouldStopAfterToolResults: BrewvaAgentEngineStopAfterToolResults | undefined;
    resolveRequestAuth: BrewvaAgentEngineResolveRequestAuth | undefined;
    resolveFile:
      | ((
          part: import("./agent-engine-types.js").BrewvaAgentEngineFileContent,
          model: BrewvaRegisteredModel,
        ) => unknown)
      | undefined;
    streamFn: BrewvaAgentEngineStreamFunction;
  }) {
    this.#state = {
      systemPrompt: "",
      model: input.initialModel ?? EMPTY_MODEL,
      thinkingLevel: input.initialThinkingLevel,
      tools: [],
      messages: [],
      isStreaming: false,
      errorMessage: undefined,
    };
    this.#queuedPromptQueue = new PendingMessageQueue(input.queueMode ?? "one-at-a-time");
    this.#followUpQueue = new PendingMessageQueue(input.followUpMode ?? "one-at-a-time");
    this.#streamFn = input.streamFn;
    this.#resolveRequestAuth = input.resolveRequestAuth;
    this.#sessionId = input.sessionId;
    this.#cachePolicy = input.cachePolicy;
    this.#transport = input.transport;
    this.#thinkingBudgets = input.thinkingBudgets;
    this.#maxRetryDelayMs = input.maxRetryDelayMs;
    this.#beforeToolCall = input.beforeToolCall;
    this.#afterToolCall = input.afterToolCall;
    this.#onPayload = input.onPayload;
    this.#onCacheRender = input.onCacheRender;
    this.#transformContext = input.transformContext;
    this.#shouldStopAfterToolResults = input.shouldStopAfterToolResults;
    this.#resolveFile = input.resolveFile;
  }

  get state() {
    return {
      model: {
        provider: this.#state.model.provider,
        id: this.#state.model.id,
      },
      thinkingLevel: this.#state.thinkingLevel,
      isStreaming: this.#state.isStreaming,
      systemPrompt: this.#state.systemPrompt,
      tools: this.#state.tools.map((tool) => ({ name: tool.name })),
    };
  }

  get signal(): AbortSignal | undefined {
    return this.#activeRun?.abortController.signal;
  }

  subscribe(
    listener: (
      event: BrewvaAgentEngineEvent,
    ) => Promise<BrewvaAgentEngineEvent | void> | BrewvaAgentEngineEvent | void,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async prompt(message: BrewvaAgentEngineMessage | BrewvaAgentEngineMessage[]): Promise<void> {
    if (this.#activeRun) {
      throw new Error(
        "Agent is already processing a prompt. Use queue() or followUp() to queue messages, or wait for completion.",
      );
    }
    const messages = Array.isArray(message) ? [...message] : [message];
    await this.#runPromptMessages(messages);
  }

  waitForIdle(): Promise<void> {
    return this.#activeRun?.promise ?? Promise.resolve();
  }

  setModel(model: unknown): void {
    this.#state.model = model as BrewvaRegisteredModel;
  }

  setThinkingLevel(level: BrewvaAgentEngineThinkingLevel): void {
    this.#state.thinkingLevel = level;
  }

  replaceMessages(messages: BrewvaAgentEngineMessage[]): void {
    this.#state.messages = [...messages];
  }

  abort(): void {
    this.#activeRun?.abortController.abort();
  }

  setTools(tools: BrewvaAgentEngineTool[]): void {
    this.#state.tools = [...tools];
  }

  setSystemPrompt(prompt: string): void {
    this.#state.systemPrompt = prompt;
  }

  followUp(message: BrewvaAgentEngineMessage): void {
    this.#followUpQueue.enqueue(message);
  }

  queue(message: BrewvaAgentEngineMessage): void {
    this.#queuedPromptQueue.enqueue(message);
  }

  steer(text: string): boolean {
    if (!this.#activeRun) {
      return false;
    }
    const cleaned = text.trim();
    if (!cleaned) {
      return false;
    }
    this.#pendingSteer = this.#pendingSteer ? `${this.#pendingSteer}\n${cleaned}` : cleaned;
    return true;
  }

  hasPendingSteer(): boolean {
    return typeof this.#pendingSteer === "string" && this.#pendingSteer.length > 0;
  }

  appendMessage(message: BrewvaAgentEngineMessage): void {
    this.#state.messages.push(message);
  }

  hasQueuedMessages(): boolean {
    return this.#queuedPromptQueue.hasItems() || this.#followUpQueue.hasItems();
  }

  async #runPromptMessages(messages: BrewvaAgentEngineMessage[]): Promise<void> {
    await this.#runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.#createContextSnapshot(),
        this.#createLoopConfig(),
        (event) => this.#processEvents(event),
        signal,
      );
    });
  }

  #createContextSnapshot(): BrewvaAgentLoopContext {
    return {
      systemPrompt: this.#state.systemPrompt,
      messages: [...this.#state.messages],
      tools: [...this.#state.tools],
    };
  }

  #createLoopConfig(): BrewvaAgentLoopConfig {
    return {
      model: this.#state.model,
      reasoning: this.#state.thinkingLevel === "off" ? undefined : this.#state.thinkingLevel,
      sessionId: this.#sessionId,
      cachePolicy: this.#cachePolicy,
      onCacheRender: this.#onCacheRender,
      onPayload: this.#onPayload as BrewvaAgentLoopConfig["onPayload"],
      transport: this.#transport,
      thinkingBudgets: this.#thinkingBudgets,
      maxRetryDelayMs: this.#maxRetryDelayMs,
      streamFn: this.#streamFn,
      beforeToolCall: this.#beforeToolCall,
      afterToolCall: this.#afterToolCall as BrewvaAgentLoopConfig["afterToolCall"],
      transformContext: this.#transformContext,
      getQueuedMessages: async () => this.#queuedPromptQueue.drain(),
      getFollowUpMessages: async () => this.#followUpQueue.drain(),
      consumePendingSteer: async () => this.#consumePendingSteer(),
      getCurrentContext: () => ({
        systemPrompt: this.#state.systemPrompt,
        tools: [...this.#state.tools],
      }),
      resolveRequestAuth: this.#resolveRequestAuth,
      resolveFile: this.#resolveFile,
      toolExecution: "parallel",
      shouldStopAfterToolResults: this.#shouldStopAfterToolResults,
    };
  }

  async #runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.#activeRun) {
      throw new Error("Agent is already processing.");
    }

    const abortController = new AbortController();
    let resolvePromise: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.#activeRun = {
      promise,
      resolve: resolvePromise,
      abortController,
    };

    this.#state.isStreaming = true;
    this.#state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this.#handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.#finishRun();
    }
  }

  async #handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    // Note: runAgentLoop handles the normal stopReason === "error" | "aborted"
    // return path itself and drains pendingSteer there. This method only runs
    // when runAgentLoop throws an uncaught error, so the two paths are
    // mutually exclusive and cannot emit steer_dropped twice.
    const pendingSteer = this.#consumePendingSteer();
    if (pendingSteer) {
      await this.#processEvents({
        type: "steer_dropped",
        text: pendingSteer,
        reason: aborted ? "aborted" : "failed",
      });
    }
    const failureMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: this.#state.model.api,
      provider: this.#state.model.provider,
      model: this.#state.model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } as BrewvaAgentEngineMessage;
    await this.#processEvents({ type: "message_start", message: failureMessage });
    const messageEnd = await this.#processEvents({ type: "message_end", message: failureMessage });
    const committedFailure =
      messageEnd.type === "message_end" ? messageEnd.message : failureMessage;
    await this.#processEvents({ type: "turn_end", message: committedFailure, toolResults: [] });
    await this.#processEvents({ type: "agent_end", messages: [committedFailure] });
  }

  #consumePendingSteer(): string | undefined {
    const text = this.#pendingSteer;
    this.#pendingSteer = undefined;
    return text;
  }

  #finishRun(): void {
    this.#state.isStreaming = false;
    this.#activeRun?.resolve();
    this.#activeRun = undefined;
  }

  async #processEvents(event: BrewvaAgentEngineEvent): Promise<BrewvaAgentEngineEvent> {
    let currentEvent = excludeTransientFailureFromEvent(event);
    for (const listener of this.#listeners) {
      const result = await listener(currentEvent);
      if (result && result.type === currentEvent.type) {
        currentEvent = excludeTransientFailureFromEvent(result);
      }
    }

    switch (currentEvent.type) {
      case "message_end":
        this.#state.messages.push(currentEvent.message);
        break;
      case "turn_end":
        if (currentEvent.message.role === "assistant" && currentEvent.message.errorMessage) {
          this.#state.errorMessage = currentEvent.message.errorMessage;
        }
        break;
      case "agent_end":
        break;
      default:
        break;
    }

    return currentEvent;
  }
}

export function createHostedAgentEngine(input: {
  initialModel: unknown;
  initialThinkingLevel: string;
  sessionId: string;
  cachePolicy?: BrewvaAgentEngineCachePolicy;
  queueMode: "all" | "one-at-a-time" | undefined;
  followUpMode: "all" | "one-at-a-time" | undefined;
  transport: BrewvaAgentEngineTransport;
  thinkingBudgets: BrewvaAgentEngineThinkingBudgets | undefined;
  maxRetryDelayMs: number | undefined;
  beforeToolCall: (
    input: BrewvaAgentEngineBeforeToolCallContext,
  ) => Promise<{ block?: boolean; reason?: string } | undefined>;
  afterToolCall: (input: BrewvaAgentEngineAfterToolCallContext) => Promise<
    | {
        content: Array<
          { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
        >;
        details: unknown;
        isError?: boolean;
      }
    | undefined
  >;
  onPayload: (
    payload: unknown,
    model: BrewvaRegisteredModel,
    metadata?: BrewvaAgentEnginePayloadMetadata,
  ) => Promise<unknown>;
  onCacheRender?: (
    render: BrewvaAgentEngineCacheRenderResult,
    model: BrewvaRegisteredModel,
  ) => void | Promise<void>;
  transformContext: (messages: BrewvaAgentEngineMessage[]) => Promise<BrewvaAgentEngineMessage[]>;
  shouldStopAfterToolResults?: BrewvaAgentEngineStopAfterToolResults;
  resolveRequestAuth?: BrewvaAgentEngineResolveRequestAuth;
  resolveFile?: (
    part: import("./agent-engine-types.js").BrewvaAgentEngineFileContent,
    model: BrewvaRegisteredModel,
  ) => unknown;
  streamFn?: BrewvaAgentEngineStreamFunction;
}): BrewvaAgentEngine {
  return new HostedBrewvaAgentEngine({
    initialModel: input.initialModel as BrewvaRegisteredModel | undefined,
    initialThinkingLevel: input.initialThinkingLevel as BrewvaAgentEngineThinkingLevel | "off",
    queueMode: input.queueMode,
    followUpMode: input.followUpMode,
    transport: input.transport,
    thinkingBudgets: input.thinkingBudgets,
    maxRetryDelayMs: input.maxRetryDelayMs,
    sessionId: input.sessionId,
    cachePolicy: input.cachePolicy,
    beforeToolCall: input.beforeToolCall,
    afterToolCall: input.afterToolCall,
    onPayload: input.onPayload,
    onCacheRender: input.onCacheRender,
    transformContext: input.transformContext,
    shouldStopAfterToolResults: input.shouldStopAfterToolResults,
    resolveRequestAuth: input.resolveRequestAuth,
    resolveFile: input.resolveFile,
    streamFn: input.streamFn ?? createHostedProviderStreamFunction(),
  });
}
