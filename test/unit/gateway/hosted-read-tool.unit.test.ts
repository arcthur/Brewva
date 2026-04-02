import { describe, expect, test } from "bun:test";
import { createReadTool, type ReadToolOptions } from "@mariozechner/pi-coding-agent";
import { createCompactReadTool } from "../../../packages/brewva-gateway/src/host/hosted-session-bootstrap.js";

describe("hosted compact read tool", () => {
  test("reads session-scoped read options at execute time", async () => {
    let autoResizeImages = true;
    const observedOptions: Array<ReadToolOptions | undefined> = [];
    const templateTool = createReadTool(process.cwd());

    const compactReadTool = createCompactReadTool({
      cwd: process.cwd(),
      getReadToolOptions: () => ({
        autoResizeImages,
      }),
      createReadDelegate: (_cwd, options) => {
        observedOptions.push(options);
        return {
          ...templateTool,
          execute: async () => ({
            content: [{ type: "text", text: "ok" }],
            details: undefined,
          }),
        };
      },
    });

    await compactReadTool.execute(
      "read-call-1",
      { path: "README.md" },
      undefined,
      undefined,
      undefined as never,
    );

    autoResizeImages = false;

    await compactReadTool.execute(
      "read-call-2",
      { path: "README.md" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(observedOptions).toEqual([
      undefined,
      { autoResizeImages: true },
      { autoResizeImages: false },
    ]);
  });
});
