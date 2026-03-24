import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface PromptDispatchSession {
  prompt: AgentSession["prompt"];
  agent: {
    waitForIdle(): Promise<void>;
  };
  sessionManager?: {
    getSessionId?: () => string;
  };
  isStreaming?: boolean;
  isCompacting?: boolean;
  dispose?: () => void;
}

export interface SubscribablePromptSession extends PromptDispatchSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
