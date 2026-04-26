import { describe, expect, test } from "bun:test";
import { OPENAI_CODEX_RESPONSES_TEST_ONLY } from "../../../packages/brewva-provider-core/src/providers/openai-codex-responses.js";

describe("openai codex responses continuation", () => {
  test("sends only the new input delta when previous response state matches", () => {
    const firstUser = {
      role: "user",
      content: [{ type: "input_text", text: "First turn" }],
    };
    const assistantOutput = {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "First answer", annotations: [] }],
    };
    const secondUser = {
      role: "user",
      content: [{ type: "input_text", text: "Second turn" }],
    };

    const outbound = OPENAI_CODEX_RESPONSES_TEST_ONLY.buildCodexContinuationRequest(
      {
        model: "gpt-5.4-codex",
        stream: true,
        instructions: "stable instructions",
        prompt_cache_key: "conversation-1",
        input: [firstUser, assistantOutput, secondUser] as never,
      },
      {
        model: "gpt-5.4-codex",
        previousRequest: {
          model: "gpt-5.4-codex",
          stream: true,
          instructions: "stable instructions",
          prompt_cache_key: "conversation-1",
          input: [firstUser] as never,
        },
        lastResponse: {
          responseId: "resp_1",
          outputItems: [assistantOutput] as never,
        },
      },
    );

    expect(outbound.previous_response_id).toBe("resp_1");
    expect(outbound.input as unknown).toEqual([secondUser]);
  });

  test("falls back to a full request when non-input request shape drifts", () => {
    const firstUser = {
      role: "user",
      content: [{ type: "input_text", text: "First turn" }],
    };
    const secondUser = {
      role: "user",
      content: [{ type: "input_text", text: "Second turn" }],
    };
    const assistantOutput = {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "First answer", annotations: [] }],
    };
    const fullInput = [firstUser, assistantOutput, secondUser];

    const outbound = OPENAI_CODEX_RESPONSES_TEST_ONLY.buildCodexContinuationRequest(
      {
        model: "gpt-5.4-codex",
        stream: true,
        instructions: "changed instructions",
        prompt_cache_key: "conversation-1",
        input: fullInput as never,
      },
      {
        model: "gpt-5.4-codex",
        previousRequest: {
          model: "gpt-5.4-codex",
          stream: true,
          instructions: "stable instructions",
          prompt_cache_key: "conversation-1",
          input: [firstUser] as never,
        },
        lastResponse: {
          responseId: "resp_1",
          outputItems: [assistantOutput] as never,
        },
      },
    );

    expect(outbound.previous_response_id).toBeUndefined();
    expect(outbound.input as unknown).toEqual(fullInput);
  });

  test("does not reuse continuation state across model switches", () => {
    const firstUser = {
      role: "user",
      content: [{ type: "input_text", text: "First turn" }],
    };
    const secondUser = {
      role: "user",
      content: [{ type: "input_text", text: "Second turn" }],
    };
    const assistantOutput = {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "First answer", annotations: [] }],
    };
    const fullInput = [firstUser, assistantOutput, secondUser];

    const outbound = OPENAI_CODEX_RESPONSES_TEST_ONLY.buildCodexContinuationRequest(
      {
        model: "gpt-5.4",
        stream: true,
        instructions: "stable instructions",
        prompt_cache_key: "conversation-1",
        input: fullInput as never,
      },
      {
        model: "gpt-5.4-mini",
        previousRequest: {
          model: "gpt-5.4",
          stream: true,
          instructions: "stable instructions",
          prompt_cache_key: "conversation-1",
          input: [firstUser] as never,
        },
        lastResponse: {
          responseId: "resp_1",
          outputItems: [assistantOutput] as never,
        },
      } as never,
    );

    expect(outbound.previous_response_id).toBeUndefined();
    expect(outbound.input as unknown).toEqual(fullInput);
  });
});
