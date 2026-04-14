import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(relativePath: string): unknown {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as unknown;
}

describe("cli contract: Brewva-native runtime boundary", () => {
  test("keeps Pi interactive runtime and Pi session bridges out of the cli runtime path", () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const indexPath = resolve(repoRoot, "packages", "brewva-cli", "src", "index.ts");
    const runtimePath = resolve(repoRoot, "packages", "brewva-cli", "src", "cli-runtime.ts");
    const runtimeEntryPath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "runtime",
      "internal-tui-runtime.ts",
    );
    const runtimeStubPath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "internal-tui-runtime.ts",
    );
    const legacyStringShellPath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "tui-app",
      "app.ts",
    );
    const legacyStringRenderPath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "tui-app",
      "render.ts",
    );
    const legacyTranscriptLayoutPath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "tui-app",
      "transcript-layout.ts",
    );
    const packageJsonPath = resolve(repoRoot, "packages", "brewva-cli", "package.json");
    const legacyPiRuntimePath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "pi-cli-runtime.ts",
    );
    const sessionBridgePath = resolve(
      repoRoot,
      "packages",
      "brewva-cli",
      "src",
      "pi-cli-session.ts",
    );

    const indexSource = readFileSync(indexPath, "utf8");
    const runtimeSource = readFileSync(runtimePath, "utf8");
    const runtimeEntrySource = existsSync(runtimeEntryPath)
      ? readFileSync(runtimeEntryPath, "utf8")
      : "";
    const runtimeStubSource = existsSync(runtimeStubPath)
      ? readFileSync(runtimeStubPath, "utf8")
      : "";
    const packageJsonSource = readFileSync(packageJsonPath, "utf8");
    expect(existsSync(legacyPiRuntimePath)).toBe(false);
    expect(existsSync(sessionBridgePath)).toBe(false);
    expect(existsSync(legacyStringShellPath)).toBe(false);
    expect(existsSync(legacyStringRenderPath)).toBe(false);
    expect(existsSync(legacyTranscriptLayoutPath)).toBe(false);

    expect(indexSource).not.toContain('from "@mariozechner/pi-coding-agent"');
    expect(indexSource).not.toContain("./pi-cli-runtime");
    expect(indexSource).not.toContain("toPiCliSession(");
    expect(indexSource).not.toContain("PI_SKIP_VERSION_CHECK");
    expect(indexSource).toContain("@brewva/brewva-cli/internal-tui-runtime");

    expect(runtimeSource).not.toContain('from "@mariozechner/pi-coding-agent"');
    expect(runtimeSource).not.toContain("toPiCliSession(");
    expect(runtimeSource).not.toContain("requireHostedPiSession");
    expect(runtimeSource).toContain("runCliInteractiveSession");
    expect(runtimeSource).toContain("runCliPrintSession");
    expect(runtimeSource).not.toContain("CliInteractiveShellApp");
    expect(runtimeSource).toContain("session.subscribe(");
    expect(runtimeSource).not.toContain("readline.createInterface");
    expect(runtimeSource).not.toContain("cli shell bootstrap invariant");
    expect(packageJsonSource).toContain('"./internal-tui-runtime"');
    expect(packageJsonSource).toContain('"bun"');
    expect(packageJsonSource).toContain('"import"');
    expect(packageJsonSource).toContain('"types"');
    expect(runtimeStubSource).toContain("OpenTUI interactive runtime");
    expect(runtimeStubSource).toContain("direct Node.js dist execution");
    expect(runtimeEntrySource).not.toContain("CliInteractiveShellApp");
    expect(runtimeEntrySource).toContain("renderCliInteractiveShell");

    expect(packageJsonSource).not.toContain('"@mariozechner/pi-coding-agent"');
    expect(packageJsonSource).toContain('"@brewva/brewva-tui"');
  });

  test("declares brewva-tui as a TypeScript project reference for clean type-aware analysis", () => {
    const tsconfig = readJson("packages/brewva-cli/tsconfig.json") as {
      references?: Array<{ path?: string }>;
    };

    expect(tsconfig.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "../brewva-tui" })]),
    );
  });

  test("declares brewva-tui for the cli runtime project graph", () => {
    const tsconfig = readJson("packages/brewva-cli/tsconfig.runtime.json") as {
      references?: Array<{ path?: string }>;
    };

    expect(tsconfig.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "../brewva-tui" })]),
    );
  });

  test("declares brewva-tui for test typechecking without prebuilt dist", () => {
    const tsconfig = readJson("test/tsconfig.json") as {
      references?: Array<{ path?: string }>;
    };

    expect(tsconfig.references).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "../packages/brewva-tui" })]),
    );
  });

  test("consumes brewva-tui root types from source instead of prebuilt dist", () => {
    const packageJson = readJson("packages/brewva-tui/package.json") as {
      types?: string;
      exports?: {
        "."?: {
          types?: string;
        };
      };
    };

    expect(packageJson.types).toBe("./src/index.ts");
    expect(packageJson.exports?.["."]?.types).toBe("./src/index.ts");
  });
});
