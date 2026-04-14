import process from "node:process";
import {
  resolveAutomaticTuiTheme,
  visibleWidth,
  visualColumnToTextOffset,
} from "@brewva/brewva-tui";
import {
  createOpenTuiCliRenderer,
  createOpenTuiRoot,
  getOpenTuiTerminalBackgroundMode,
  openTuiReact,
  type OpenTuiKeyEvent,
  type OpenTuiRenderer,
  type OpenTuiRoot,
  type OpenTuiScrollBoxHandle,
  type OpenTuiTextareaHandle,
  useOpenTuiKeyboard,
  useOpenTuiTerminalDimensions,
} from "@brewva/brewva-tui/internal-opentui-runtime";
import type React from "react";
import {
  getExternalPagerCommand,
  openExternalEditorWithShell,
  openExternalPagerWithShell,
} from "../src/external-process.js";
import {
  CliShellController,
  type CliShellControllerOptions,
  type CliShellSemanticInput,
} from "../src/tui-app/controller.js";
import {
  createShellChrome,
  notificationTone,
  overlayStatusLabel,
  roleTone,
  type ShellChrome,
} from "../src/tui-app/shell-chrome.js";
import {
  computeCompletionOverlayLayout,
  computeOverlaySurfaceLayout,
  computeShellLayout,
  type ShellOverlayVariant,
} from "../src/tui-app/shell-layout.js";
import type {
  CliShellNotification,
  CliShellState,
  CliShellTranscriptEntry,
} from "../src/tui-app/state/index.js";
import { buildTaskRunListLabel, buildTaskRunPreviewLines } from "../src/tui-app/task-details.js";
import {
  computeTranscriptVisibleWindow,
  measureRenderedTranscriptEntryHeight,
  renderTranscriptEntryBodyLines,
  transcriptRoleLabel,
} from "../src/tui-app/transcript.js";
import type {
  CliApprovalOverlayPayload,
  CliInputOverlayPayload,
  CliInspectOverlayPayload,
  CliNotificationsOverlayPayload,
  CliPagerOverlayPayload,
  CliQuestionOverlayPayload,
  CliSelectOverlayPayload,
  CliSessionsOverlayPayload,
  CliShellSessionBundle,
  CliTasksOverlayPayload,
} from "../src/tui-app/types.js";

const { createElement: h, useEffect, useMemo, useState, useSyncExternalStore } = openTuiReact;
const TRANSCRIPT_ENTRY_NODE_CACHE = new WeakMap<
  CliShellTranscriptEntry,
  Map<string, React.ReactNode>
>();
const STREAMING_TRANSCRIPT_ENTRY_NODE_CACHE = new Map<
  string,
  Map<string, { text: string; node: React.ReactNode }>
>();

// OpenTUI's logicalCursor.col is measured in terminal display columns (CJK
// characters are 2 columns wide). These helpers convert between that coordinate
// and the JS UTF-16 string offset used by the controller's text state.

function textOffsetFromLogicalCursor(
  text: string,
  cursor: {
    row: number;
    col: number;
  },
): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row] ?? "";
    if (row === cursor.row) {
      return offset + visualColumnToTextOffset(line, cursor.col);
    }
    offset += line.length + 1;
  }
  return text.length;
}

function logicalCursorFromTextOffset(text: string, offset: number): { row: number; col: number } {
  const boundedOffset = Math.max(0, Math.min(text.length, offset));
  const before = text.slice(0, boundedOffset);
  const lines = before.split("\n");
  const lastLine = lines.at(-1) ?? "";
  return {
    row: Math.max(0, lines.length - 1),
    col: visibleWidth(lastLine),
  };
}

function toSemanticInput(event: OpenTuiKeyEvent): CliShellSemanticInput {
  const normalizedKey =
    event.name.length === 1 && !event.ctrl && !event.meta ? "character" : event.name;
  return {
    key: normalizedKey,
    text:
      normalizedKey === "character"
        ? event.sequence.length > 0
          ? event.sequence
          : event.name
        : undefined,
    ctrl: event.ctrl,
    meta: event.meta,
    shift: event.shift,
  };
}

function renderNotificationSummary(notification: CliShellNotification): string {
  return `[${notification.level}] ${notification.message}`;
}

function useShellState(controller: CliShellController): CliShellState {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
}

function renderTranscriptEntryNode(
  entry: CliShellTranscriptEntry,
  transcriptWidth: number,
  chrome: ShellChrome,
  theme: CliShellState["theme"],
): React.ReactNode {
  const cacheKey = `${theme.name}:${transcriptWidth}`;
  if (entry.renderMode === "streaming") {
    const cachedByWidth =
      STREAMING_TRANSCRIPT_ENTRY_NODE_CACHE.get(entry.id) ??
      new Map<string, { text: string; node: React.ReactNode }>();
    const cachedNode = cachedByWidth.get(cacheKey);
    if (cachedNode?.text === entry.text) {
      return cachedNode.node;
    }
    const label = `${transcriptRoleLabel(entry.role)}:`;
    const bodyLines = renderTranscriptEntryBodyLines(entry, transcriptWidth);
    const nextNode = h(
      "box",
      {
        key: entry.id,
        style: {
          width: "100%",
          flexDirection: "column",
          marginBottom: 1,
        },
      },
      h("text", {
        key: `${entry.id}:label`,
        content: label,
        style: {
          fg: roleTone(entry, theme),
          bold: entry.role !== "system" && entry.role !== "custom",
        },
      }),
      ...bodyLines.map((line, index) =>
        h("text", {
          key: `${entry.id}:line:${index}`,
          content: line,
          style: {
            fg: chrome.transcript.textColor,
          },
        }),
      ),
    );
    cachedByWidth.set(cacheKey, {
      text: entry.text,
      node: nextNode,
    });
    STREAMING_TRANSCRIPT_ENTRY_NODE_CACHE.set(entry.id, cachedByWidth);
    return nextNode;
  }

  // Entry is stable — evict any stale streaming cache for this ID.
  if (STREAMING_TRANSCRIPT_ENTRY_NODE_CACHE.has(entry.id)) {
    STREAMING_TRANSCRIPT_ENTRY_NODE_CACHE.delete(entry.id);
  }

  const cachedByWidth = TRANSCRIPT_ENTRY_NODE_CACHE.get(entry);
  const cachedNode = cachedByWidth?.get(cacheKey);
  if (cachedNode) {
    return cachedNode;
  }

  const label = `${transcriptRoleLabel(entry.role)}:`;
  const bodyLines = renderTranscriptEntryBodyLines(entry, transcriptWidth);
  const nextNode = h(
    "box",
    {
      key: entry.id,
      style: {
        width: "100%",
        flexDirection: "column",
        marginBottom: 1,
      },
    },
    h("text", {
      key: `${entry.id}:label`,
      content: label,
      style: {
        fg: roleTone(entry, theme),
        bold: entry.role !== "system" && entry.role !== "custom",
      },
    }),
    ...bodyLines.map((line, index) =>
      h("text", {
        key: `${entry.id}:line:${index}`,
        content: line,
        style: {
          fg: chrome.transcript.textColor,
        },
      }),
    ),
  );

  const widthCache = cachedByWidth ?? new Map<string, React.ReactNode>();
  widthCache.set(cacheKey, nextNode);
  TRANSCRIPT_ENTRY_NODE_CACHE.set(entry, widthCache);
  return nextNode;
}

function renderVerticalSpacer(key: string, height: number): React.ReactNode | null {
  if (height <= 0) {
    return null;
  }
  return h("box", {
    key,
    style: {
      width: "100%",
      height,
    },
  });
}

function handleSemanticInputSafely(
  controller: CliShellController,
  semanticInput: CliShellSemanticInput,
): void {
  void controller.handleSemanticInput(semanticInput).catch((error) => {
    controller.ui.notify(
      error instanceof Error ? error.message : "Failed to process interactive input.",
      "error",
    );
  });
}

function TranscriptPane(input: {
  entries: CliShellTranscriptEntry[];
  width: number;
  viewportHeight: number;
  followMode: "live" | "scrolled";
  scrollOffset: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
  scrollboxRef: (node: OpenTuiScrollBoxHandle | null) => void;
}) {
  const transcriptWidth = Math.max(20, input.width - 6);
  // Separate memo so totalHeight is only recomputed when entries or width change,
  // not on every scroll offset change.
  const totalHeight = useMemo(
    () =>
      input.entries.reduce(
        (sum, entry) => sum + measureRenderedTranscriptEntryHeight(entry, transcriptWidth),
        0,
      ),
    [input.entries, transcriptWidth],
  );
  const renderedWindow = useMemo(() => {
    const visibleWindow = computeTranscriptVisibleWindow({
      entries: input.entries,
      width: transcriptWidth,
      viewportHeight: input.viewportHeight,
      followMode: input.followMode,
      scrollOffset: input.scrollOffset,
      overscanLines: Math.max(4, Math.floor(input.viewportHeight / 3)),
      precomputedTotalHeight: totalHeight,
    });
    return {
      topPadding: visibleWindow.topPadding,
      bottomPadding: visibleWindow.bottomPadding,
      entryNodes: input.entries
        .slice(visibleWindow.startIndex, visibleWindow.endIndex)
        .map((entry) =>
          renderTranscriptEntryNode(entry, transcriptWidth, input.chrome, input.theme),
        ),
    };
  }, [
    input.chrome,
    input.entries,
    input.followMode,
    input.scrollOffset,
    input.theme,
    input.viewportHeight,
    totalHeight,
    transcriptWidth,
  ]);

  return h(
    "scrollbox",
    {
      ref: input.scrollboxRef,
      stickyScroll: input.followMode === "live",
      stickyStart: "bottom",
      viewportCulling: true,
      style: {
        flexGrow: 1,
        width: "100%",
        height: "100%",
        border: true,
        padding: 1,
        borderColor: input.chrome.transcript.borderColor,
        backgroundColor: input.chrome.transcript.backgroundColor,
      },
    },
    renderVerticalSpacer("transcript:top-padding", renderedWindow.topPadding),
    ...renderedWindow.entryNodes,
    renderVerticalSpacer("transcript:bottom-padding", renderedWindow.bottomPadding),
  );
}

function WidgetRail(input: {
  state: CliShellState;
  width: number;
  chrome: ShellChrome;
  mode: "rail" | "stacked";
}) {
  const widgets = Object.entries(input.state.status.widgets);
  if (widgets.length === 0) {
    return null;
  }
  return h(
    "box",
    {
      style: {
        width: input.width,
        marginLeft: input.mode === "rail" ? 1 : 0,
        marginTop: input.mode === "stacked" ? 1 : 0,
        flexDirection: "column",
        flexShrink: 0,
      },
    },
    ...widgets.map(([id, widget]) =>
      h(
        "box",
        {
          key: id,
          style: {
            width: "100%",
            border: true,
            borderColor: input.chrome.railCard.borderColor,
            backgroundColor: input.chrome.railCard.backgroundColor,
            padding: 1,
            flexDirection: "column",
            marginBottom: 1,
          },
        },
        h("text", {
          key: `${id}:title`,
          content: id,
          style: { fg: input.chrome.railCard.titleColor, bold: true },
        }),
        ...widget.lines.map((line, index) =>
          h("text", {
            key: `${id}:line:${index}`,
            content: line,
            style: { fg: input.chrome.railCard.textColor },
          }),
        ),
      ),
    ),
  );
}

function CompletionOverlay(input: {
  state: CliShellState;
  width: number;
  height: number;
  composerTop: number;
  chrome: ShellChrome;
}) {
  const completion = input.state.composer.completion;
  if (!completion || completion.items.length === 0) {
    return null;
  }
  const items = completion.items.slice(0, 6);
  const title = `Completions (${completion.kind})`;
  const overlay = computeCompletionOverlayLayout({
    width: input.width,
    height: input.height,
    composerTop: input.composerTop,
    title,
    items,
  });
  return h(
    "box",
    {
      position: "absolute",
      zIndex: 20,
      left: overlay.left,
      top: overlay.top,
      width: overlay.width,
      height: overlay.height,
      style: {
        border: true,
        borderColor: input.chrome.completion.borderColor,
        backgroundColor: input.chrome.completion.backgroundColor,
        padding: 1,
        flexDirection: "column",
      },
    },
    h("text", {
      key: "completion:title",
      content: title,
      style: { fg: input.chrome.completion.titleColor, bold: true },
    }),
    ...items.map((item, index) =>
      h("text", {
        key: `${completion.kind}:${item}`,
        content: `${index === completion.selectedIndex ? "›" : " "} ${item}`,
        style: {
          fg:
            index === completion.selectedIndex
              ? input.chrome.completion.selectedTextColor
              : input.chrome.completion.textColor,
          bg:
            index === completion.selectedIndex
              ? input.chrome.completion.selectedBackgroundColor
              : undefined,
          bold: index === completion.selectedIndex,
        },
      }),
    ),
  );
}

function windowSelection<T>(
  items: readonly T[],
  selectedIndex: number,
  maxVisible: number,
): {
  items: T[];
  startIndex: number;
} {
  if (items.length <= maxVisible) {
    return {
      items: [...items],
      startIndex: 0,
    };
  }
  const visibleCount = Math.max(1, maxVisible);
  const start = Math.max(
    0,
    Math.min(items.length - visibleCount, selectedIndex - Math.floor(visibleCount / 2)),
  );
  return {
    items: items.slice(start, start + visibleCount),
    startIndex: start,
  };
}

function visibleLineWindow(lines: readonly string[], requestedOffset: number, maxVisible: number) {
  const visibleCount = Math.max(1, maxVisible);
  const maxOffset = Math.max(0, lines.length - visibleCount);
  const offset = Math.max(0, Math.min(requestedOffset, maxOffset));
  return {
    offset,
    start: lines.length === 0 ? 0 : offset + 1,
    end: Math.min(lines.length, offset + visibleCount),
    visibleLines: lines.slice(offset, offset + visibleCount),
  };
}

function OverlaySurface(input: {
  width: number;
  height: number;
  title: string;
  chrome: ShellChrome;
  variant: ShellOverlayVariant;
  footer?: string;
  children: React.ReactNode[];
}) {
  const layout = computeOverlaySurfaceLayout({
    width: input.width,
    height: input.height,
    variant: input.variant,
  });
  return h(
    "box",
    {
      position: "absolute",
      zIndex: 30,
      left: layout.left,
      top: layout.top,
      width: layout.width,
      height: layout.height,
      style: {
        border: true,
        borderColor: input.chrome.overlay.borderColorByVariant[input.variant],
        backgroundColor: input.chrome.overlay.backgroundColor,
        padding: 1,
        flexDirection: "column",
      },
    },
    h("text", {
      key: "overlay:title",
      content: input.title,
      style: { fg: input.chrome.overlay.titleColor, bold: true },
    }),
    h(
      "box",
      {
        key: "overlay:body",
        style: {
          width: "100%",
          flexGrow: 1,
          flexDirection: "column",
          marginTop: 1,
        },
      },
      ...input.children,
    ),
    input.footer
      ? h("text", {
          key: "overlay:footer",
          content: input.footer,
          style: { fg: input.chrome.status.detailColor },
        })
      : null,
  );
}

function RenderSelectionList(input: {
  items: readonly string[];
  selectedIndex: number;
  chrome: ShellChrome;
  maxVisible?: number;
}) {
  const maxVisible = input.maxVisible ?? 7;
  const selectionWindow = windowSelection(input.items, input.selectedIndex, maxVisible);
  const visibleItems = selectionWindow.items;
  const selectionHeight = Math.max(4, Math.min(maxVisible + 2, visibleItems.length + 2));
  return h(
    "box",
    {
      style: {
        width: "100%",
        flexDirection: "column",
        border: true,
        borderColor: input.chrome.selectionList.borderColor,
        backgroundColor: input.chrome.selectionList.backgroundColor,
        padding: 1,
        marginTop: 1,
        flexShrink: 0,
        height: selectionHeight,
      },
    },
    ...visibleItems.map((item, index) => {
      const absoluteIndex = selectionWindow.startIndex + index;
      const selected = absoluteIndex === input.selectedIndex;
      return h("text", {
        key: `selection:${absoluteIndex}`,
        content: `${selected ? "›" : " "} ${item}`,
        style: {
          fg: selected
            ? input.chrome.selectionList.selectedTextColor
            : input.chrome.selectionList.textColor,
          bg: selected ? input.chrome.selectionList.selectedBackgroundColor : undefined,
          bold: selected,
        },
      });
    }),
  );
}

function RenderDetailsPanel(input: {
  lines: readonly string[];
  borderColor: string;
  chrome: ShellChrome;
  title?: string;
}) {
  const detailsHeight = Math.max(6, Math.min(10, input.lines.length + (input.title ? 3 : 2)));
  const visibleLines = input.lines.slice(0, Math.max(1, detailsHeight - (input.title ? 3 : 2)));
  return h(
    "box",
    {
      style: {
        width: "100%",
        flexDirection: "column",
        border: true,
        borderColor: input.borderColor,
        backgroundColor: input.chrome.selectionList.backgroundColor,
        padding: 1,
        marginTop: 1,
        height: detailsHeight,
        flexShrink: 0,
      },
    },
    input.title
      ? h("text", {
          key: "details:title",
          content: input.title,
          style: { fg: input.chrome.status.detailColor, bold: true },
        })
      : null,
    ...visibleLines.map((line, index) =>
      h("text", {
        key: `details:${index}`,
        content: line,
        style: { fg: input.chrome.selectionList.textColor },
      }),
    ),
  );
}

function RenderScrollablePanel(input: {
  lines: readonly string[];
  borderColor: string;
  chrome: ShellChrome;
  title?: string;
  scrollOffset: number;
  maxVisible: number;
}) {
  const window = visibleLineWindow(input.lines, input.scrollOffset, input.maxVisible);
  const detailsHeight = Math.max(
    6,
    Math.min(
      input.maxVisible + (input.title ? 4 : 3),
      window.visibleLines.length + (input.title ? 4 : 3),
    ),
  );
  const footer =
    input.lines.length > 0 ? `${window.start}-${window.end} / ${input.lines.length}` : "0 / 0";
  return h(
    "box",
    {
      style: {
        width: "100%",
        flexDirection: "column",
        border: true,
        borderColor: input.borderColor,
        backgroundColor: input.chrome.selectionList.backgroundColor,
        padding: 1,
        marginTop: 1,
        height: detailsHeight,
        flexShrink: 0,
      },
    },
    input.title
      ? h("text", {
          key: "scrollable:title",
          content: input.title,
          style: { fg: input.chrome.status.detailColor, bold: true },
        })
      : null,
    ...window.visibleLines.map((line, index) =>
      h("text", {
        key: `scrollable:${index}`,
        content: line.length > 0 ? line : " ",
        style: { fg: input.chrome.selectionList.textColor },
      }),
    ),
    h("text", {
      key: "scrollable:footer",
      content: footer,
      style: { fg: input.chrome.status.detailColor },
    }),
  );
}

function ApprovalOverlay(input: {
  payload: CliApprovalOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const selected = input.payload.snapshot.approvals[input.payload.selectedIndex];
  const items = input.payload.snapshot.approvals.map(
    (item) => `${item.requestId} ${item.toolName} :: ${item.subject}`,
  );
  const details = selected
    ? [
        `requestId: ${selected.requestId}`,
        `tool: ${selected.toolName}`,
        `subject: ${selected.subject}`,
        `boundary: ${selected.boundary}`,
        `effects: ${selected.effects.join(", ")}`,
        selected.argsSummary ? `args: ${selected.argsSummary}` : undefined,
      ].filter((entry): entry is string => Boolean(entry))
    : ["No pending approvals."];
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Approvals",
    chrome: input.chrome,
    variant: "queue",
    footer: "Enter/a accept · r reject · Esc close",
    children: [
      h("text", {
        key: "approval:meta",
        content: `Pending approvals: ${input.payload.snapshot.approvals.length}`,
        style: { fg: input.chrome.status.detailColor },
      }),
      RenderSelectionList({
        items: items.length > 0 ? items : ["No pending approvals."],
        chrome: input.chrome,
        selectedIndex:
          items.length > 0
            ? Math.max(0, Math.min(input.payload.selectedIndex, items.length - 1))
            : 0,
      }),
      RenderDetailsPanel({
        lines: details,
        chrome: input.chrome,
        borderColor: input.theme.warning,
        title: "Details",
      }),
    ],
  });
}

function QuestionOverlay(input: {
  payload: CliQuestionOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const selected = input.payload.snapshot.questions[input.payload.selectedIndex];
  const items = input.payload.snapshot.questions.map(
    (item) => `${item.questionId} ${item.sourceLabel} :: ${item.questionText}`,
  );
  const details = selected
    ? [
        `questionId: ${selected.questionId}`,
        `source: ${selected.sourceLabel}`,
        `question: ${selected.questionText}`,
      ]
    : ["No open questions."];
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Questions",
    chrome: input.chrome,
    variant: "queue",
    footer: "Enter drafts an answer in the composer · Esc close",
    children: [
      h("text", {
        key: "question:meta",
        content: `Open questions: ${input.payload.snapshot.questions.length}`,
        style: { fg: input.chrome.status.detailColor },
      }),
      RenderSelectionList({
        items: items.length > 0 ? items : ["No open questions."],
        chrome: input.chrome,
        selectedIndex:
          items.length > 0
            ? Math.max(0, Math.min(input.payload.selectedIndex, items.length - 1))
            : 0,
      }),
      RenderDetailsPanel({
        lines: details,
        chrome: input.chrome,
        borderColor: input.theme.accent,
        title: "Details",
      }),
    ],
  });
}

function TasksOverlay(input: {
  payload: CliTasksOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const selected = input.payload.snapshot.taskRuns[input.payload.selectedIndex];
  const items = input.payload.snapshot.taskRuns.map((item) => buildTaskRunListLabel(item));
  const details = selected ? buildTaskRunPreviewLines(selected) : ["No recorded task runs."];
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Tasks",
    chrome: input.chrome,
    variant: "queue",
    footer: "Enter opens output · c stops selected task · Esc close",
    children: [
      h("text", {
        key: "tasks:meta",
        content: `Task runs: ${input.payload.snapshot.taskRuns.length}`,
        style: { fg: input.chrome.status.detailColor },
      }),
      RenderSelectionList({
        items: items.length > 0 ? items : ["No recorded task runs."],
        chrome: input.chrome,
        selectedIndex:
          items.length > 0
            ? Math.max(0, Math.min(input.payload.selectedIndex, items.length - 1))
            : 0,
      }),
      RenderDetailsPanel({
        lines: details,
        chrome: input.chrome,
        borderColor: input.theme.warning,
        title: "Output",
      }),
    ],
  });
}

function SessionsOverlay(input: {
  payload: CliSessionsOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const selected = input.payload.sessions[input.payload.selectedIndex];
  const items = input.payload.sessions.map((item) => {
    const current = item.sessionId === input.payload.currentSessionId ? " current" : "";
    const draft = input.payload.draftStateBySessionId[item.sessionId];
    const draftText = draft ? ` draft saved (${draft.lines}l)` : "";
    return `${item.sessionId} events=${item.eventCount}${current}${draftText}`;
  });
  const selectedDraft = selected
    ? input.payload.draftStateBySessionId[selected.sessionId]
    : undefined;
  const details = selected
    ? [
        `sessionId: ${selected.sessionId}`,
        `events: ${selected.eventCount}`,
        `last event: ${selected.lastEventAt > 0 ? new Date(selected.lastEventAt).toISOString() : "none yet"}`,
        `current: ${selected.sessionId === input.payload.currentSessionId ? "yes" : "no"}`,
        selectedDraft
          ? `draft saved: ${selectedDraft.lines} lines / ${selectedDraft.characters} chars`
          : "draft saved: no",
        ...(selectedDraft?.preview ? ["", selectedDraft.preview] : []),
      ]
    : ["No replay sessions found."];
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Sessions",
    chrome: input.chrome,
    variant: "queue",
    footer: "Enter switches session · n creates a new session · Esc close",
    children: [
      h("text", {
        key: "sessions:meta",
        content: `Sessions: ${input.payload.sessions.length}`,
        style: { fg: input.chrome.status.detailColor },
      }),
      RenderSelectionList({
        items: items.length > 0 ? items : ["No sessions found."],
        chrome: input.chrome,
        selectedIndex:
          items.length > 0
            ? Math.max(0, Math.min(input.payload.selectedIndex, items.length - 1))
            : 0,
      }),
      RenderDetailsPanel({
        lines: details,
        chrome: input.chrome,
        borderColor: input.theme.border,
        title: "Details",
      }),
    ],
  });
}

function NotificationsOverlay(input: {
  payload: CliNotificationsOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const selected = input.payload.notifications[input.payload.selectedIndex];
  const items = input.payload.notifications.map((notification) =>
    renderNotificationSummary(notification),
  );
  const details = selected
    ? [
        `id: ${selected.id}`,
        `level: ${selected.level}`,
        `createdAt: ${new Date(selected.createdAt).toISOString()}`,
        "",
        ...selected.message.split(/\r?\n/u),
      ]
    : ["No notifications."];
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Notifications",
    chrome: input.chrome,
    variant: "queue",
    footer: "Enter details · d dismiss · x clear all · Esc close",
    children: [
      h("text", {
        key: "notifications:meta",
        content: `Notifications: ${input.payload.notifications.length}`,
        style: { fg: input.chrome.status.detailColor },
      }),
      RenderSelectionList({
        items: items.length > 0 ? items : ["No notifications."],
        chrome: input.chrome,
        selectedIndex:
          items.length > 0
            ? Math.max(0, Math.min(input.payload.selectedIndex, items.length - 1))
            : 0,
      }),
      RenderDetailsPanel({
        lines: details,
        chrome: input.chrome,
        borderColor: selected ? notificationTone(selected, input.theme) : input.theme.border,
        title: "Details",
      }),
    ],
  });
}

function InspectOverlay(input: {
  payload: CliInspectOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const sections = input.payload.sections;
  const safeSelectedIndex =
    sections.length > 0
      ? Math.max(0, Math.min(input.payload.selectedIndex, sections.length - 1))
      : 0;
  const selectedSection = sections[safeSelectedIndex];
  const sectionItems = sections.map((section) => section.title);
  const scrollOffset = input.payload.scrollOffsets[safeSelectedIndex] ?? 0;
  const detailVisibleCount = Math.max(6, Math.floor(input.height * 0.38));

  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Inspect",
    chrome: input.chrome,
    variant: "inspector",
    footer: "Enter drill down · Arrows switch sections · PgUp/PgDn details · Esc close",
    children: [
      h(
        "box",
        {
          key: "inspect:layout",
          style: {
            width: "100%",
            flexDirection: "row",
            alignItems: "flex-start",
          },
        },
        h(
          "box",
          {
            key: "inspect:sections",
            style: {
              width: Math.max(24, Math.floor(input.width * 0.28)),
              flexDirection: "column",
              marginRight: 1,
            },
          },
          h("text", {
            key: "inspect:sections:title",
            content: "Sections",
            style: { fg: input.chrome.status.detailColor, bold: true },
          }),
          h(
            "box",
            {
              key: "inspect:sections:list",
              style: {
                width: "100%",
                flexDirection: "column",
                border: true,
                borderColor: input.chrome.selectionList.borderColor,
                backgroundColor: input.chrome.selectionList.backgroundColor,
                padding: 1,
                marginTop: 1,
              },
            },
            ...(sectionItems.length > 0 ? sectionItems : ["No inspect sections."]).map(
              (item, index) =>
                h("text", {
                  key: `inspect:section:${index}`,
                  content: `${index === safeSelectedIndex ? "›" : " "} ${item}`,
                  style: {
                    fg:
                      index === safeSelectedIndex
                        ? input.chrome.selectionList.selectedTextColor
                        : input.chrome.selectionList.textColor,
                    bg:
                      index === safeSelectedIndex
                        ? input.chrome.selectionList.selectedBackgroundColor
                        : undefined,
                    bold: index === safeSelectedIndex,
                  },
                }),
            ),
          ),
        ),
        h(
          "box",
          {
            key: "inspect:details",
            style: {
              flexGrow: 1,
              flexDirection: "column",
            },
          },
          RenderScrollablePanel({
            lines: selectedSection?.lines ?? ["No inspect details."],
            chrome: input.chrome,
            borderColor: input.theme.borderActive,
            title: selectedSection?.title ?? "Details",
            scrollOffset,
            maxVisible: detailVisibleCount,
          }),
        ),
      ),
    ],
  });
}

function PagerOverlay(input: {
  payload: CliPagerOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: input.payload.title ?? "Pager",
    chrome: input.chrome,
    variant: "pager",
    footer: "Arrows scroll · PgUp/PgDn page · Esc close/back",
    children: [
      RenderScrollablePanel({
        lines: input.payload.lines,
        chrome: input.chrome,
        borderColor: input.theme.border,
        title: undefined,
        scrollOffset: input.payload.scrollOffset,
        maxVisible: Math.max(8, Math.floor(input.height * 0.48)),
      }),
    ],
  });
}

function TextBlockOverlay(input: {
  title: string;
  lines: readonly string[];
  footer?: string;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
  variant?: ShellOverlayVariant;
}) {
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: input.title,
    chrome: input.chrome,
    variant: input.variant ?? "dialog",
    footer: input.footer,
    children: [
      h(
        "box",
        {
          key: "text-block",
          style: {
            width: "100%",
            flexDirection: "column",
            border: true,
            borderColor: input.theme.border,
            backgroundColor: input.chrome.selectionList.backgroundColor,
            padding: 1,
          },
        },
        ...input.lines.slice(0, Math.max(1, Math.floor(input.height * 0.45))).map((line, index) =>
          h("text", {
            key: `text-block:${index}`,
            content: line,
            style: { fg: input.chrome.selectionList.textColor },
          }),
        ),
      ),
    ],
  });
}

function InputDialogOverlay(input: {
  payload: CliInputOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const children: React.ReactNode[] = [];
  if (input.payload.message) {
    children.push(
      h("text", {
        key: "input:message",
        content: input.payload.message,
        style: { fg: input.chrome.status.detailColor },
      }),
    );
  }
  children.push(
    h(
      "box",
      {
        key: "input:value-box",
        style: {
          width: "100%",
          border: true,
          borderColor: input.theme.borderActive,
          backgroundColor: input.chrome.selectionList.backgroundColor,
          padding: 1,
          marginTop: 1,
        },
      },
      h("text", {
        content: input.payload.value.length > 0 ? input.payload.value : " ",
        style: { fg: input.chrome.selectionList.textColor },
      }),
    ),
  );
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Input",
    chrome: input.chrome,
    variant: "dialog",
    footer: "Enter confirm · Esc cancel",
    children,
  });
}

function SelectDialogOverlay(input: {
  payload: CliSelectOverlayPayload;
  width: number;
  height: number;
  chrome: ShellChrome;
}) {
  return OverlaySurface({
    width: input.width,
    height: input.height,
    title: "Select",
    chrome: input.chrome,
    variant: "dialog",
    footer: "Enter confirm · Esc cancel",
    children: [
      RenderSelectionList({
        items: input.payload.options,
        chrome: input.chrome,
        selectedIndex: Math.max(
          0,
          Math.min(input.payload.selectedIndex, input.payload.options.length - 1),
        ),
      }),
    ],
  });
}

function ModalOverlay(input: {
  state: CliShellState;
  width: number;
  height: number;
  chrome: ShellChrome;
}) {
  const overlay = input.state.overlay.active;
  if (!overlay) {
    return null;
  }
  const payload = overlay.payload;
  if (!payload) {
    return TextBlockOverlay({
      title: overlay.title ?? overlay.kind,
      lines: overlay.lines ?? [],
      width: input.width,
      height: input.height,
      chrome: input.chrome,
      theme: input.state.theme,
      footer: "Esc close",
    });
  }
  switch (payload.kind) {
    case "approval":
      return ApprovalOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "question":
      return QuestionOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "tasks":
      return TasksOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "sessions":
      return SessionsOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "notifications":
      return NotificationsOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "inspect":
      return InspectOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "pager":
      return PagerOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "confirm":
      return TextBlockOverlay({
        title: "Confirm",
        lines: [payload.message],
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
        footer: "Enter/y confirm · n/Esc cancel",
      });
    case "input":
      return InputDialogOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
      });
    case "select":
      return SelectDialogOverlay({
        payload,
        width: input.width,
        height: input.height,
        chrome: input.chrome,
      });
    default:
      return TextBlockOverlay({
        title: overlay.title ?? overlay.kind,
        lines: overlay.lines ?? [],
        width: input.width,
        height: input.height,
        chrome: input.chrome,
        theme: input.state.theme,
        footer: "Esc close",
      });
  }
}

function NotificationStrip(input: {
  notifications: readonly CliShellNotification[];
  chrome: ShellChrome;
  theme: CliShellState["theme"];
}) {
  const latest = input.notifications.at(-1);
  if (!latest) {
    return null;
  }
  const suffix =
    input.notifications.length > 1
      ? ` (+${input.notifications.length - 1} more · Ctrl+N inbox)`
      : " · Ctrl+N inbox";
  return h(
    "box",
    {
      style: {
        width: "100%",
        border: true,
        borderColor: notificationTone(latest, input.theme),
        backgroundColor: input.chrome.notification.backgroundColor,
        paddingLeft: 1,
        paddingRight: 1,
        marginBottom: 1,
      },
    },
    h("text", {
      content: `[${latest.level}] ${latest.message}${suffix}`,
      style: {
        fg: notificationTone(latest, input.theme),
      },
    }),
  );
}

function StatusDetails(input: { state: CliShellState; chrome: ShellChrome }) {
  const details = [
    input.state.status.workingMessage ? `Working: ${input.state.status.workingMessage}` : undefined,
    input.state.status.hiddenThinkingLabel
      ? `Thinking: ${input.state.status.hiddenThinkingLabel}`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (details.length === 0) {
    return null;
  }
  return h(
    "box",
    {
      style: {
        width: "100%",
        flexDirection: "column",
        marginTop: 1,
      },
    },
    ...details.map((detail, index) =>
      h("text", {
        key: `detail:${index}`,
        content: detail,
        style: { fg: input.chrome.status.detailColor },
      }),
    ),
  );
}

function StatusBar(input: { state: CliShellState; chrome: ShellChrome }) {
  const leftParts = [
    input.state.status.title,
    ...Object.entries(input.state.status.entries)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  const rightParts = [
    input.state.transcript.followMode === "live" ? "live" : "scrolled",
    input.state.overlay.active?.kind
      ? overlayStatusLabel(input.state.overlay.active.kind)
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return h(
    "box",
    {
      style: {
        width: "100%",
        border: true,
        borderColor: input.chrome.status.barBorderColor,
        backgroundColor: input.state.theme.backgroundPanel,
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "row",
        justifyContent: "space-between",
      },
    },
    h("text", {
      content: leftParts.join(" | "),
      style: { fg: input.chrome.status.barTextColor, bold: true },
    }),
    h("text", {
      content: rightParts.join(" | "),
      style: { fg: input.chrome.status.barMetaColor, bold: true },
    }),
  );
}

function ComposerPane(input: {
  controller: CliShellController;
  state: CliShellState;
  width: number;
  chrome: ShellChrome;
  boxHeight: number;
  textareaHeight: number;
}) {
  const [textarea, setTextarea] = useState<OpenTuiTextareaHandle | null>(null);

  useEffect(() => {
    if (!textarea || textarea.isDestroyed) {
      return undefined;
    }

    const syncFromEditor = () => {
      if (textarea.isDestroyed) {
        return;
      }
      input.controller.syncComposerFromEditor(
        textarea.plainText,
        textOffsetFromLogicalCursor(textarea.plainText, textarea.logicalCursor),
      );
    };

    textarea.editBuffer.on("content-changed", syncFromEditor);
    textarea.editBuffer.on("cursor-changed", syncFromEditor);
    return () => {
      textarea.editBuffer.off("content-changed", syncFromEditor);
      textarea.editBuffer.off("cursor-changed", syncFromEditor);
    };
  }, [input.controller, textarea]);

  useEffect(() => {
    if (!textarea || textarea.isDestroyed) {
      return;
    }
    if (textarea.plainText !== input.state.composer.text) {
      textarea.setText(input.state.composer.text);
    }
    const desiredCursor = logicalCursorFromTextOffset(
      input.state.composer.text,
      input.state.composer.cursor,
    );
    if (
      textarea.logicalCursor.row !== desiredCursor.row ||
      textarea.logicalCursor.col !== desiredCursor.col
    ) {
      textarea.setCursor(desiredCursor.row, desiredCursor.col);
    }
  }, [input.state.composer.cursor, input.state.composer.text, textarea]);

  useEffect(() => {
    if (!textarea || textarea.isDestroyed) {
      return;
    }
    if (!input.state.overlay.active) {
      textarea.focus();
      return;
    }
    textarea.blur();
  }, [input.state.overlay.active, textarea]);

  return h(
    "box",
    {
      style: {
        width: "100%",
        border: true,
        borderColor: input.chrome.composer.borderColor,
        backgroundColor: input.chrome.composer.backgroundColor,
        padding: 1,
        marginTop: 1,
        height: input.boxHeight,
      },
    },
    h("textarea", {
      ref: (node: OpenTuiTextareaHandle | null) => setTextarea(node),
      focused: !input.state.overlay.active,
      initialValue: input.state.composer.text,
      onSubmit: () => {
        handleSemanticInputSafely(input.controller, {
          key: "enter",
          ctrl: false,
          meta: false,
          shift: false,
        });
      },
      style: {
        width: Math.max(12, input.width - 8),
        height: input.textareaHeight,
        backgroundColor: input.chrome.composer.textareaBackgroundColor,
        textColor: input.chrome.composer.textColor,
        focusedBackgroundColor: input.chrome.composer.textareaBackgroundColor,
        focusedTextColor: input.chrome.composer.textColor,
        placeholderColor: input.chrome.composer.placeholderColor,
      },
      placeholder: "Ask Brewva...",
    }),
  );
}

export function BrewvaOpenTuiShell(input: { controller: CliShellController }) {
  const state = useShellState(input.controller);
  const { width, height } = useOpenTuiTerminalDimensions();
  const [scrollbox, setScrollbox] = useState<OpenTuiScrollBoxHandle | null>(null);
  const chrome = useMemo(() => createShellChrome(state.theme), [state.theme]);
  const statusDetailLines = [state.status.workingMessage, state.status.hiddenThinkingLabel].filter(
    (entry) => typeof entry === "string" && entry.length > 0,
  ).length;
  const layout = useMemo(
    () =>
      computeShellLayout({
        width,
        height,
        hasWidgets: Object.keys(state.status.widgets).length > 0,
        headerLines: state.status.headerLines.length,
        footerLines: state.status.footerLines.length,
        notificationVisible: state.notifications.length > 0,
        statusDetailLines,
      }),
    [
      height,
      state.notifications.length,
      state.status.footerLines.length,
      state.status.headerLines.length,
      state.status.hiddenThinkingLabel,
      state.status.widgets,
      state.status.workingMessage,
      width,
    ],
  );
  const composerTop = Math.max(
    1,
    height - layout.composer.boxHeight - layout.statusBarHeight - state.status.footerLines.length,
  );
  const transcriptViewportHeight = scrollbox?.viewport.height
    ? Math.max(1, scrollbox.viewport.height)
    : layout.transcriptViewportFallbackHeight;

  useEffect(() => {
    input.controller.setViewportSize(width, height);
  }, [height, input.controller, width]);

  useEffect(() => {
    if (!scrollbox || scrollbox.isDestroyed) {
      return;
    }
    if (state.transcript.followMode === "live") {
      scrollbox.stickyScroll = true;
      scrollbox.stickyStart = "bottom";
      scrollbox.scrollTop = Math.max(0, scrollbox.scrollHeight);
      return;
    }
    scrollbox.stickyScroll = false;
    const maxScrollTop = Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height);
    scrollbox.scrollTop = Math.max(0, maxScrollTop - state.transcript.scrollOffset);
  }, [
    scrollbox,
    state.transcript.entries,
    state.transcript.followMode,
    state.transcript.scrollOffset,
    width,
    height,
  ]);

  useOpenTuiKeyboard((event) => {
    const semanticInput = toSemanticInput(event);
    if (!input.controller.wantsSemanticInput(semanticInput)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    handleSemanticInputSafely(input.controller, semanticInput);
  });

  return h(
    "box",
    {
      style: {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: chrome.appBackground,
        padding: 1,
      },
    },
    ...state.status.headerLines.map((line, index) =>
      h("text", {
        key: `header:${index}`,
        content: line,
        style: { fg: state.theme.textDim },
      }),
    ),
    NotificationStrip({ notifications: state.notifications, chrome, theme: state.theme }),
    h(
      "box",
      {
        style: {
          width: "100%",
          flexGrow: layout.mainArea.mode === "rail" ? 1 : 0,
          height:
            layout.mainArea.mode === "stacked"
              ? layout.transcriptViewportFallbackHeight + 2
              : undefined,
          flexDirection: layout.mainArea.mode === "stacked" ? "column" : "row",
        },
      },
      h(
        "box",
        {
          style: {
            flexGrow: 1,
            height: "100%",
          },
        },
        h(TranscriptPane, {
          entries: state.transcript.entries,
          width: layout.mainArea.transcriptWidth,
          viewportHeight: transcriptViewportHeight,
          followMode: state.transcript.followMode,
          scrollOffset: state.transcript.scrollOffset,
          chrome,
          theme: state.theme,
          scrollboxRef: setScrollbox,
        }),
      ),
      layout.mainArea.mode === "rail" && layout.mainArea.widgetWidth > 0
        ? h(WidgetRail, {
            state,
            width: layout.mainArea.widgetWidth,
            chrome,
            mode: "rail",
          })
        : null,
    ),
    layout.mainArea.mode === "stacked" && layout.mainArea.widgetWidth > 0
      ? h(WidgetRail, {
          state,
          width: layout.mainArea.widgetWidth,
          chrome,
          mode: "stacked",
        })
      : null,
    h(StatusDetails, { state, chrome }),
    h(ComposerPane, {
      controller: input.controller,
      state,
      width,
      chrome,
      boxHeight: layout.composer.boxHeight,
      textareaHeight: layout.composer.textareaHeight,
    }),
    ...state.status.footerLines.map((line, index) =>
      h("text", {
        key: `footer:${index}`,
        content: line,
        style: { fg: state.theme.textDim },
      }),
    ),
    h(StatusBar, { state, chrome }),
    h(CompletionOverlay, { state, width, height, composerTop, chrome }),
    h(ModalOverlay, { state, width, height, chrome }),
  );
}

class CliInteractiveOpenTuiRuntime {
  #renderer: OpenTuiRenderer | undefined;
  #root: OpenTuiRoot | undefined;

  constructor(private readonly controller: CliShellController) {}

  async run(): Promise<void> {
    const automaticTheme = resolveAutomaticTuiTheme(await getOpenTuiTerminalBackgroundMode());
    this.controller.ui.setTheme(automaticTheme.name);
    await this.mount();
    await this.controller.start();
    try {
      await this.controller.waitForExit();
    } finally {
      this.controller.dispose();
      this.unmount();
    }
  }

  async openExternalEditor(title: string, prefill?: string): Promise<string | undefined> {
    const editor = process.env.VISUAL ?? process.env.EDITOR;
    if (!editor) {
      return prefill;
    }
    this.unmount();
    try {
      return await openExternalEditorWithShell(editor, title, prefill);
    } finally {
      await this.mount();
    }
  }

  async openExternalPager(title: string, lines: readonly string[]): Promise<boolean> {
    const pager = getExternalPagerCommand();
    if (!pager) {
      return false;
    }
    this.unmount();
    try {
      return await openExternalPagerWithShell(pager, title, lines);
    } finally {
      await this.mount();
    }
  }

  private async mount(): Promise<void> {
    this.#renderer = await createOpenTuiCliRenderer();
    this.#root = createOpenTuiRoot(this.#renderer);
    this.#root.render(h(BrewvaOpenTuiShell, { controller: this.controller }));
  }

  private unmount(): void {
    this.#root?.unmount();
    this.#root = undefined;
    this.#renderer?.destroy();
    this.#renderer = undefined;
  }
}

export async function renderCliInteractiveShell(
  bundle: CliShellSessionBundle,
  options: Omit<CliShellControllerOptions, "openExternalEditor" | "openExternalPager">,
): Promise<void> {
  let runtime: CliInteractiveOpenTuiRuntime | undefined;
  const controller = new CliShellController(bundle, {
    ...options,
    async openExternalEditor(title, prefill) {
      return await runtime?.openExternalEditor(title, prefill);
    },
    async openExternalPager(title, lines) {
      return (await runtime?.openExternalPager(title, lines)) ?? false;
    },
  });
  runtime = new CliInteractiveOpenTuiRuntime(controller);
  await runtime.run();
}
