import { describe, expect, test } from "bun:test";
import { scanSecurityPatternContent } from "../../../script/check-security-patterns.js";

describe("security pattern lint", () => {
  test("catches raw error payload leaks", () => {
    const violations = scanSecurityPatternContent(
      "fixture.ts",
      `
recordEvent({
  payload: {
    error: error.message,
  },
});
`,
    );

    expect(violations.map((violation) => violation.rule)).toContain("raw-error-event-payload");
  });

  test("catches raw command and env audit payloads", () => {
    const violations = scanSecurityPatternContent(
      "fixture.ts",
      `
recordExecEvent(runtime, sessionId, "exec_routed", {
  payload: {
    command: input.command,
    env: input.env,
  },
});
`,
    );

    expect(violations.map((violation) => violation.rule)).toContain(
      "raw-command-env-event-payload",
    );
  });

  test("accepts sanitized event payloads", () => {
    const violations = scanSecurityPatternContent(
      "fixture.ts",
      `
recordExecEvent(runtime, sessionId, "exec_routed", {
  payload: {
    error: redactTextForAudit(message),
    commandHash: hashCommandForAudit(command),
    commandRedacted: redactCommandForAudit(command),
  },
});
`,
    );

    expect(violations).toEqual([]);
  });

  test("requires explicit allow comment for shell command concatenation", () => {
    const unsafe = scanSecurityPatternContent(
      "fixture.ts",
      `
const shellCommand =
  prefixClauses.length > 0 ? \`\${prefixClauses.join(" && ")} && \${input.command}\` : input.command;
`,
    );
    expect(unsafe.map((violation) => violation.rule)).toContain("direct-shell-command-concat");

    const allowed = scanSecurityPatternContent(
      "fixture.ts",
      `
// security-pattern-allow direct-shell-command-concat: escaped prefix plus governed command.
const shellCommand =
  prefixClauses.length > 0 ? \`\${prefixClauses.join(" && ")} && \${input.command}\` : input.command;
`,
    );
    expect(allowed).toEqual([]);
  });
});
