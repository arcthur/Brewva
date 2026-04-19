import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function resolveHostCompileTarget(): Bun.Build.CompileTarget | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "bun-darwin-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "bun-darwin-x64";
  if (process.platform === "linux" && process.arch === "x64") return "bun-linux-x64";
  if (process.platform === "linux" && process.arch === "arm64") return "bun-linux-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "bun-windows-x64";
  return null;
}

describe("search tokenizer contract", () => {
  test("compiled ASCII-only tokenization still fails fast when mandatory jieba asset is absent", async () => {
    const compileTarget = resolveHostCompileTarget();
    if (!compileTarget) {
      return;
    }

    const repoRoot = resolve(import.meta.dirname, "../../..");
    const scratchRoot = join(repoRoot, "packages", "brewva-search", ".tmp");
    const sourceRoot = join(scratchRoot, "test-search-tokenizer");
    mkdirSync(sourceRoot, { recursive: true });
    const sourceDir = mkdtempSync(join(sourceRoot, "src-"));
    const outputDir = mkdtempSync(join(tmpdir(), "brewva-search-tokenizer-bin-"));
    const entrypoint = join(sourceDir, "entry.ts");
    const outfile = join(
      outputDir,
      process.platform === "win32" ? "search-smoke.exe" : "search-smoke",
    );

    try {
      writeFileSync(
        entrypoint,
        [
          'import { tokenizeSearchText } from "../../../src/index.ts";',
          'console.log(tokenizeSearchText("brewva runtime").join("|"));',
        ].join("\n"),
        "utf8",
      );

      const build = Bun.spawnSync({
        cmd: [
          process.execPath,
          "build",
          entrypoint,
          "--compile",
          "--minify",
          "--target",
          compileTarget,
          "--outfile",
          outfile,
        ],
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(build.exitCode).toBe(0);
      expect(existsSync(join(outputDir, "jieba_rs_wasm_bg.wasm"))).toBe(false);

      const result = Bun.spawnSync([outfile], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain("jieba-wasm asset is missing");
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
