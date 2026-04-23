/** @jsxImportSource @opentui/solid */

import { getTranscriptSyntaxStyle, type SessionPalette } from "./palette.js";
import { inferFiletype } from "./tool-render.js";

export type ShellDiffStyle = "auto" | "stacked";
export type ShellDiffWrapMode = "word" | "none";
export type ShellDiffViewMode = "split" | "unified";

export function resolveDiffView(width: number, style: ShellDiffStyle): ShellDiffViewMode {
  if (style === "stacked") {
    return "unified";
  }
  return width > 120 ? "split" : "unified";
}

export function formatDiffFileTitle(file: {
  displayPath: string;
  action?: string;
  movePath?: string;
}): string {
  if (file.action === "add" || file.action === "create") {
    return `# Created ${file.displayPath}`;
  }
  if (file.action === "delete" || file.action === "remove") {
    return `# Deleted ${file.displayPath}`;
  }
  if (file.action === "move" || file.action === "rename") {
    return file.movePath
      ? `# Moved ${file.displayPath} → ${file.movePath}`
      : `# Moved ${file.displayPath}`;
  }
  return `← Patch ${file.displayPath}`;
}

export function DiffView(input: {
  diff: string;
  filePath?: string;
  width: number;
  style: ShellDiffStyle;
  wrapMode: ShellDiffWrapMode;
  theme: SessionPalette;
}) {
  return (
    <diff
      diff={input.diff}
      view={resolveDiffView(input.width, input.style)}
      wrapMode={input.wrapMode}
      showLineNumbers={true}
      width="100%"
      filetype={inferFiletype(input.filePath)}
      syntaxStyle={getTranscriptSyntaxStyle(input.theme)}
      fg={input.theme.text}
      addedBg={input.theme.diffAddedBg}
      removedBg={input.theme.diffRemovedBg}
      contextBg={input.theme.diffContextBg}
      addedSignColor={input.theme.diffHighlightAdded}
      removedSignColor={input.theme.diffHighlightRemoved}
      lineNumberFg={input.theme.diffLineNumber}
      lineNumberBg={input.theme.diffContextBg}
      addedLineNumberBg={input.theme.diffAddedLineNumberBg}
      removedLineNumberBg={input.theme.diffRemovedLineNumberBg}
    />
  );
}
