import { createA2ATools } from "@brewva/brewva-tools";
import type { RuntimePlugin, RuntimePluginApi } from "../runtime-plugins/index.js";

export interface ChannelA2AAdapter {
  send(input: {
    fromSessionId: string;
    fromAgentId?: string;
    toAgentId: string;
    message: string;
    correlationId?: string;
    depth?: number;
    hops?: number;
  }): Promise<{
    ok: boolean;
    toAgentId: string;
    responseText?: string;
    error?: string;
    depth?: number;
    hops?: number;
  }>;
  broadcast(input: {
    fromSessionId: string;
    fromAgentId?: string;
    toAgentIds: string[];
    message: string;
    correlationId?: string;
    depth?: number;
    hops?: number;
  }): Promise<{
    ok: boolean;
    error?: string;
    results: Array<{
      toAgentId: string;
      ok: boolean;
      responseText?: string;
      error?: string;
      depth?: number;
      hops?: number;
    }>;
  }>;
  listAgents(input?: { includeDeleted?: boolean }): Promise<
    Array<{
      agentId: string;
      status: "active" | "deleted";
    }>
  >;
}

export function createChannelA2ARuntimePlugin(options: {
  adapter: ChannelA2AAdapter;
}): RuntimePlugin {
  return (runtimePluginApi: RuntimePluginApi) => {
    const tools = createA2ATools({
      runtime: {
        orchestration: {
          a2a: options.adapter,
        },
      },
    });
    const ensureRegistered = () => {
      const currentNames = new Set(runtimePluginApi.getAllTools().map((tool) => tool.name));
      for (const tool of tools) {
        if (currentNames.has(tool.name)) continue;
        runtimePluginApi.registerTool(tool);
      }
    };

    runtimePluginApi.on("session_start", () => {
      ensureRegistered();
      return undefined;
    });
  };
}
