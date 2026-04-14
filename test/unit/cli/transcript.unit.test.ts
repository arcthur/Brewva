import { describe, expect, test } from "bun:test";
import {
  computeTranscriptVisibleWindow,
  measureRenderedTranscriptEntryHeight,
  measureTranscriptEntryLines,
  renderTranscriptEntryBodyLines,
} from "../../../packages/brewva-cli/src/tui-app/transcript.js";

describe("cli transcript rendering", () => {
  test("renders stable transcript entries through the markdown renderer", () => {
    const lines = renderTranscriptEntryBodyLines(
      {
        id: "assistant:1",
        role: "assistant",
        text: "# Plan\n\n- first item\n- second item\n\n```ts\nconst value = 1;\n```",
      },
      40,
      "stable",
    );

    expect(lines).toContain("# Plan");
    expect(lines).toContain("• first item");
    expect(lines).toContain("• second item");
    expect(lines).toContain("```ts");
    expect(lines).toContain("  const value = 1;");
  });

  test("treats streaming transcript entries as plain wrapped text", () => {
    const entry = {
      id: "assistant:2",
      role: "assistant" as const,
      text: "# heading\n- bullet",
      renderMode: "streaming" as const,
    };

    const lines = renderTranscriptEntryBodyLines(entry, 40);

    expect(lines).toEqual(["# heading", "- bullet"]);
    expect(measureTranscriptEntryLines(entry, 40)).toBe(3);
  });

  test("reuses streaming transcript caches across immutable entry replacements", () => {
    const firstEntry = {
      id: "assistant:stream",
      role: "assistant" as const,
      text: "Streaming response",
      renderMode: "streaming" as const,
    };
    const replacedEntry = {
      ...firstEntry,
    };
    const updatedEntry = {
      ...firstEntry,
      text: "Streaming response updated",
    };

    const firstLines = renderTranscriptEntryBodyLines(firstEntry, 40);
    const replacedLines = renderTranscriptEntryBodyLines(replacedEntry, 40);
    const updatedLines = renderTranscriptEntryBodyLines(updatedEntry, 40);

    expect(replacedLines).toBe(firstLines);
    expect(updatedLines).not.toBe(firstLines);
  });

  test("computes a bottom-anchored visible window for scrolled transcripts", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `assistant:${index + 1}`,
      role: "assistant" as const,
      text: `entry-${index + 1}`,
    }));

    const entryHeight = measureRenderedTranscriptEntryHeight(entries[0]!, 40);
    const window = computeTranscriptVisibleWindow({
      entries,
      width: 40,
      viewportHeight: entryHeight * 3,
      followMode: "scrolled",
      scrollOffset: entryHeight * 4,
      overscanLines: 0,
    });

    expect(window.startIndex).toBe(5);
    expect(window.endIndex).toBe(8);
    expect(window.topPadding).toBe(entryHeight * 5);
    expect(window.bottomPadding).toBe(entryHeight * 4);
  });

  test("extends the visible window with overscan for live transcripts", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      id: `assistant:${index + 1}`,
      role: "assistant" as const,
      text: `entry-${index + 1}`,
    }));

    const entryHeight = measureRenderedTranscriptEntryHeight(entries[0]!, 40);
    const window = computeTranscriptVisibleWindow({
      entries,
      width: 40,
      viewportHeight: entryHeight * 2,
      followMode: "live",
      scrollOffset: 0,
      overscanLines: entryHeight,
    });

    expect(window.startIndex).toBe(7);
    expect(window.endIndex).toBe(10);
    expect(window.topPadding).toBe(entryHeight * 7);
    expect(window.bottomPadding).toBe(0);
  });
});
