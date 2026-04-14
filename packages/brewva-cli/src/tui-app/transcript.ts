import { wrapTextToLines } from "@brewva/brewva-tui";
import { renderMarkdownToLines } from "./markdown.js";
import type { CliShellTranscriptEntry } from "./state/index.js";

export type TranscriptRenderMode = "stable" | "streaming";

export interface TranscriptVisibleWindow {
  startIndex: number;
  endIndex: number;
  topPadding: number;
  bottomPadding: number;
  totalHeight: number;
}

const TRANSCRIPT_BODY_LINES_CACHE = new WeakMap<CliShellTranscriptEntry, Map<string, string[]>>();
const TRANSCRIPT_RENDERED_HEIGHT_CACHE = new WeakMap<
  CliShellTranscriptEntry,
  Map<number, number>
>();
const STREAMING_TRANSCRIPT_BODY_LINES_CACHE = new Map<
  string,
  Map<number, { text: string; lines: string[] }>
>();
const STREAMING_TRANSCRIPT_RENDERED_HEIGHT_CACHE = new Map<
  string,
  Map<number, { text: string; height: number }>
>();

function transcriptCacheKey(width: number, mode: TranscriptRenderMode): string {
  return `${mode}:${Math.max(12, width)}`;
}

function resolveTranscriptRenderMode(
  entry: CliShellTranscriptEntry,
  mode?: TranscriptRenderMode,
): TranscriptRenderMode {
  return mode ?? entry.renderMode ?? "stable";
}

export function transcriptRoleLabel(role: CliShellTranscriptEntry["role"]): string {
  switch (role) {
    case "assistant":
      return "Brewva";
    case "user":
      return "You";
    case "tool":
      return "Tool";
    case "custom":
      return "Note";
    default:
      return "System";
  }
}

export function renderTranscriptEntryBodyLines(
  entry: CliShellTranscriptEntry,
  width: number,
  mode?: TranscriptRenderMode,
): string[] {
  const boundedWidth = Math.max(12, width);
  const resolvedMode = resolveTranscriptRenderMode(entry, mode);
  if (resolvedMode === "streaming") {
    const widthCache =
      STREAMING_TRANSCRIPT_BODY_LINES_CACHE.get(entry.id) ??
      new Map<number, { text: string; lines: string[] }>();
    const cachedLines = widthCache.get(boundedWidth);
    if (cachedLines?.text === entry.text) {
      return cachedLines.lines;
    }
    const nextLines = wrapTextToLines(entry.text, boundedWidth);
    widthCache.set(boundedWidth, {
      text: entry.text,
      lines: nextLines,
    });
    STREAMING_TRANSCRIPT_BODY_LINES_CACHE.set(entry.id, widthCache);
    return nextLines;
  }

  const cacheKey = transcriptCacheKey(boundedWidth, resolvedMode);
  const cachedLines = TRANSCRIPT_BODY_LINES_CACHE.get(entry)?.get(cacheKey);
  if (cachedLines) {
    return cachedLines;
  }

  const nextLines = renderMarkdownToLines(entry.text, boundedWidth);
  const widthCache = TRANSCRIPT_BODY_LINES_CACHE.get(entry) ?? new Map<string, string[]>();
  widthCache.set(cacheKey, nextLines);
  TRANSCRIPT_BODY_LINES_CACHE.set(entry, widthCache);
  return nextLines;
}

export function measureTranscriptEntryLines(
  entry: CliShellTranscriptEntry,
  width: number,
  mode?: TranscriptRenderMode,
): number {
  return 1 + renderTranscriptEntryBodyLines(entry, width, mode).length;
}

export function measureRenderedTranscriptEntryHeight(
  entry: CliShellTranscriptEntry,
  width: number,
  mode?: TranscriptRenderMode,
): number {
  const boundedWidth = Math.max(12, width);
  const resolvedMode = resolveTranscriptRenderMode(entry, mode);
  if (resolvedMode === "streaming") {
    const widthCache =
      STREAMING_TRANSCRIPT_RENDERED_HEIGHT_CACHE.get(entry.id) ??
      new Map<number, { text: string; height: number }>();
    const cachedHeight = widthCache.get(boundedWidth);
    if (cachedHeight?.text === entry.text) {
      return cachedHeight.height;
    }
    const nextHeight = measureTranscriptEntryLines(entry, boundedWidth, resolvedMode) + 1;
    widthCache.set(boundedWidth, {
      text: entry.text,
      height: nextHeight,
    });
    STREAMING_TRANSCRIPT_RENDERED_HEIGHT_CACHE.set(entry.id, widthCache);
    return nextHeight;
  }

  const cachedHeight = TRANSCRIPT_RENDERED_HEIGHT_CACHE.get(entry)?.get(boundedWidth);
  if (typeof cachedHeight === "number") {
    return cachedHeight;
  }

  const nextHeight = measureTranscriptEntryLines(entry, boundedWidth, resolvedMode) + 1;
  const widthCache = TRANSCRIPT_RENDERED_HEIGHT_CACHE.get(entry) ?? new Map<number, number>();
  widthCache.set(boundedWidth, nextHeight);
  TRANSCRIPT_RENDERED_HEIGHT_CACHE.set(entry, widthCache);
  return nextHeight;
}

export function computeTranscriptVisibleWindow(input: {
  entries: readonly CliShellTranscriptEntry[];
  width: number;
  viewportHeight: number;
  followMode: "live" | "scrolled";
  scrollOffset: number;
  overscanLines?: number;
  /** Pre-computed total height from a separate memo; skips the O(entries) accumulation loop. */
  precomputedTotalHeight?: number;
}): TranscriptVisibleWindow {
  if (input.entries.length === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topPadding: 0,
      bottomPadding: 0,
      totalHeight: 0,
    };
  }

  const boundedWidth = Math.max(12, input.width);
  const viewportHeight = Math.max(1, input.viewportHeight);
  const overscanLines = Math.max(0, input.overscanLines ?? 4);
  let totalHeight: number;
  if (input.precomputedTotalHeight !== undefined) {
    totalHeight = input.precomputedTotalHeight;
  } else {
    totalHeight = 0;
    for (const entry of input.entries) {
      totalHeight += measureRenderedTranscriptEntryHeight(entry, boundedWidth);
    }
  }
  const visibleBottom =
    input.followMode === "live"
      ? totalHeight
      : Math.max(0, totalHeight - Math.max(0, input.scrollOffset));
  const visibleTop = Math.max(0, visibleBottom - viewportHeight);
  const targetTop = Math.max(0, visibleTop - overscanLines);
  const targetBottom = Math.min(totalHeight, visibleBottom + overscanLines);

  let topPadding = 0;
  let startIndex = 0;
  while (startIndex < input.entries.length) {
    const entryHeight = measureRenderedTranscriptEntryHeight(
      input.entries[startIndex]!,
      boundedWidth,
    );
    if (topPadding + entryHeight > targetTop) {
      break;
    }
    topPadding += entryHeight;
    startIndex += 1;
  }

  let renderedHeight = topPadding;
  let endIndex = startIndex;
  while (endIndex < input.entries.length && renderedHeight < targetBottom) {
    renderedHeight += measureRenderedTranscriptEntryHeight(input.entries[endIndex]!, boundedWidth);
    endIndex += 1;
  }

  if (endIndex <= startIndex && startIndex < input.entries.length) {
    endIndex = Math.min(input.entries.length, startIndex + 1);
    renderedHeight =
      topPadding + measureRenderedTranscriptEntryHeight(input.entries[startIndex]!, boundedWidth);
  }

  return {
    startIndex,
    endIndex,
    topPadding,
    bottomPadding: Math.max(0, totalHeight - renderedHeight),
    totalHeight,
  };
}
