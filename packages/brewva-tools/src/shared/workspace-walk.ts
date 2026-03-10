import { readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SKIPPED_WORKSPACE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

const DEFAULT_ALLOWED_HIDDEN_DIRS = new Set([".config"]);

export interface WalkWorkspaceFilesOptions {
  roots: readonly string[];
  maxFiles: number;
  isMatch(filePath: string): boolean;
  skippedDirs?: ReadonlySet<string>;
  allowedHiddenDirs?: ReadonlySet<string>;
  includeRootFiles?: boolean;
}

export function walkWorkspaceFiles(input: WalkWorkspaceFilesOptions): {
  files: string[];
  overflow: boolean;
} {
  const seen = new Set<string>();
  const files: string[] = [];
  let overflow = false;
  const skippedDirs = input.skippedDirs ?? DEFAULT_SKIPPED_WORKSPACE_DIRS;
  const allowedHiddenDirs = input.allowedHiddenDirs ?? DEFAULT_ALLOWED_HIDDEN_DIRS;
  const includeRootFiles = input.includeRootFiles ?? true;

  const visit = (target: string, isRoot = false): void => {
    if (overflow) {
      return;
    }

    let canonicalTarget = target;
    try {
      canonicalTarget = realpathSync(target);
    } catch {
      canonicalTarget = target;
    }
    if (seen.has(canonicalTarget)) {
      return;
    }
    seen.add(canonicalTarget);

    let stats: import("node:fs").Stats;
    try {
      stats = statSync(canonicalTarget);
    } catch {
      return;
    }

    if (stats.isDirectory()) {
      let entries: Array<import("node:fs").Dirent>;
      try {
        entries = readdirSync(canonicalTarget, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (overflow) {
          return;
        }
        if (entry.name.startsWith(".") && !allowedHiddenDirs.has(entry.name)) {
          continue;
        }
        if (entry.isDirectory() && skippedDirs.has(entry.name)) {
          continue;
        }
        visit(join(canonicalTarget, entry.name));
      }
      return;
    }

    if (isRoot && !includeRootFiles) {
      return;
    }
    if (!stats.isFile() || !input.isMatch(canonicalTarget)) {
      return;
    }
    if (files.length >= input.maxFiles) {
      overflow = true;
      return;
    }
    files.push(canonicalTarget);
  };

  for (const root of input.roots) {
    visit(root, true);
  }

  return {
    files,
    overflow,
  };
}
