/** @jsxImportSource @opentui/solid */

import type { OpenTuiScrollBoxHandle } from "@brewva/brewva-tui/internal-opentui-runtime";
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "solid-js";
import { For, Show, createEffect, createMemo } from "solid-js";
import type { CliShellController } from "../../src/shell/controller.js";
import type {
  CliApprovalOverlayPayload,
  CliQuestionOverlayPayload,
} from "../../src/shell/types.js";
import { DiffView, formatDiffFileTitle } from "./diff-view.js";
import { DIALOG_Z_INDEX } from "./overlay-style.js";
import { DEFAULT_SCROLL_ACCELERATION, SPLIT_BORDER_CHARS, type SessionPalette } from "./palette.js";
import { useShellRenderContext } from "./render-context.js";
import {
  asRecord,
  readDiffPayloadFromDetails,
  readDiffSourceRecordFromDetails,
} from "./tool-render.js";

export function PromptActionChip(input: {
  label: string;
  active?: boolean;
  theme: SessionPalette;
  onSelect?: () => void;
}) {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={input.active ? input.theme.warning : input.theme.backgroundMenu}
      onMouseUp={() => input.onSelect?.()}
    >
      <text fg={input.active ? input.theme.selectionText : input.theme.textMuted}>
        {input.label}
      </text>
    </box>
  );
}

function InlinePromptCard(input: {
  title: string;
  theme: SessionPalette;
  accentColor: string;
  expanded?: boolean;
  header?: JSX.Element;
  body: JSX.Element;
  actions: ReadonlyArray<{
    label: string;
    active?: boolean;
    onSelect?: () => void;
  }>;
  hints: readonly string[];
}) {
  const dimensions = useTerminalDimensions();
  const narrow = createMemo(() => dimensions().width < 90);
  return (
    <box
      backgroundColor={input.theme.backgroundPanel}
      border={["left"]}
      borderColor={input.accentColor}
      customBorderChars={SPLIT_BORDER_CHARS}
      flexDirection="column"
      zIndex={input.expanded ? DIALOG_Z_INDEX - 1 : undefined}
      {...(input.expanded
        ? {
            position: "absolute",
            top: 0,
            bottom: 1,
            left: 0,
            right: 0,
          }
        : {
            position: "relative",
            maxHeight: 15,
          })}
    >
      <box
        gap={1}
        paddingLeft={1}
        paddingRight={3}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
        flexGrow={input.expanded ? 1 : undefined}
        flexShrink={input.expanded ? 1 : 0}
      >
        <Show
          when={input.header}
          fallback={
            <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
              <text fg={input.accentColor}>△</text>
              <text fg={input.theme.text}>{input.title}</text>
            </box>
          }
        >
          <box paddingLeft={1} flexShrink={0}>
            {input.header}
          </box>
        </Show>
        {input.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={input.theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={input.actions}>
            {(action) => (
              <PromptActionChip
                label={action.label}
                active={action.active}
                theme={input.theme}
                onSelect={action.onSelect}
              />
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <For each={input.hints}>{(hint) => <text fg={input.theme.textMuted}>{hint}</text>}</For>
        </box>
      </box>
    </box>
  );
}

export function InlineApprovalPrompt(input: {
  controller: CliShellController;
  payload: CliApprovalOverlayPayload;
  theme: SessionPalette;
  transcriptWidth: number;
}) {
  let previewScrollbox: OpenTuiScrollBoxHandle | undefined;
  const shellContext = useShellRenderContext();
  const dimensions = useTerminalDimensions();
  const request = createMemo(() => input.payload.snapshot.approvals[input.payload.selectedIndex]);
  const previewRecord = createMemo(() => {
    const record = asRecord(request());
    return readDiffSourceRecordFromDetails(record);
  });
  const diffPayload = createMemo(() => {
    const preview = previewRecord();
    const path =
      typeof preview?.filePath === "string"
        ? preview.filePath
        : typeof preview?.path === "string"
          ? preview.path
          : undefined;
    return readDiffPayloadFromDetails(preview, path);
  });
  const singleDiff = createMemo(() => {
    const current = diffPayload();
    return current?.kind === "single" ? current : undefined;
  });
  const diffFiles = createMemo(() => {
    const current = diffPayload();
    return current?.kind === "files" ? current.files : [];
  });
  const previewError = createMemo(() => {
    const value = previewRecord()?.error;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  });
  const previewPath = createMemo(
    () =>
      singleDiff()?.path ??
      diffFiles()[0]?.displayPath ??
      (typeof previewRecord()?.path === "string" ? (previewRecord()?.path as string) : undefined),
  );
  const hasPreviewBody = createMemo(
    () => Boolean(singleDiff()) || diffFiles().length > 0 || Boolean(previewError()),
  );
  const previewHeight = createMemo(() => {
    if (input.payload.previewExpanded) {
      return Math.max(6, dimensions().height - 12);
    }
    return Math.max(5, Math.min(10, Math.floor(dimensions().height / 3)));
  });
  createEffect(() => {
    const node = previewScrollbox;
    if (!node || node.isDestroyed) {
      return;
    }
    node.scrollTop = Math.max(0, input.payload.previewScrollOffset ?? 0);
  });
  return (
    <Show
      when={request()}
      fallback={
        <InlinePromptCard
          title="Approvals"
          theme={input.theme}
          accentColor={input.theme.borderActive}
          body={
            <box paddingLeft={1} flexDirection="column" gap={1}>
              <text fg={input.theme.text}>No pending approvals.</text>
              <text fg={input.theme.textMuted}>
                Brewva will show permission requests here when a tool needs approval.
              </text>
            </box>
          }
          actions={[]}
          hints={["esc close"]}
        />
      }
    >
      {(entry) => (
        <InlinePromptCard
          title="Permission required"
          theme={input.theme}
          accentColor={input.theme.warning}
          expanded={input.payload.previewExpanded}
          header={
            <box flexDirection="column" gap={0}>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={input.theme.warning}>△</text>
                <text fg={input.theme.text}>Permission required</text>
              </box>
              <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0}>
                <text fg={input.theme.textMuted} flexShrink={0}>
                  {hasPreviewBody() ? "→" : "•"}
                </text>
                <text fg={input.theme.text}>
                  {hasPreviewBody() ? `Edit ${previewPath() ?? entry().subject}` : entry().subject}
                </text>
              </box>
            </box>
          }
          body={
            <box paddingLeft={1} flexDirection="column" gap={1}>
              <Show
                when={hasPreviewBody()}
                fallback={
                  <>
                    <text fg={input.theme.textMuted}>Tool: {entry().toolName}</text>
                    <text fg={input.theme.textMuted}>Boundary: {entry().boundary}</text>
                    <text fg={input.theme.textMuted}>
                      Effects: {entry().effects.length > 0 ? entry().effects.join(", ") : "none"}
                    </text>
                    <Show when={entry().argsSummary}>
                      <text fg={input.theme.text}>{entry().argsSummary}</text>
                    </Show>
                  </>
                }
              >
                <scrollbox
                  ref={(node: OpenTuiScrollBoxHandle) => {
                    previewScrollbox = node;
                  }}
                  height={previewHeight()}
                  backgroundColor={input.theme.backgroundPanel}
                  scrollAcceleration={DEFAULT_SCROLL_ACCELERATION}
                  verticalScrollbarOptions={{
                    trackOptions: {
                      backgroundColor: input.theme.backgroundElement,
                      foregroundColor: input.theme.borderActive,
                    },
                  }}
                >
                  <Show when={previewError()}>
                    <box paddingLeft={1} paddingRight={1}>
                      <text fg={input.theme.warning}>{previewError()}</text>
                    </box>
                  </Show>
                  <Show when={singleDiff()}>
                    <DiffView
                      diff={singleDiff()?.diff ?? ""}
                      filePath={singleDiff()?.path}
                      width={input.transcriptWidth}
                      style={shellContext.diffStyle()}
                      wrapMode={shellContext.diffWrapMode()}
                      theme={input.theme}
                    />
                  </Show>
                  <Show when={diffFiles().length > 0}>
                    <box flexDirection="column" gap={1}>
                      <For each={diffFiles()}>
                        {(file) => (
                          <box flexDirection="column" gap={1}>
                            <text fg={input.theme.textMuted}>{formatDiffFileTitle(file)}</text>
                            <Show
                              when={file.diff.length > 0}
                              fallback={
                                <text fg={input.theme.diffRemoved}>
                                  -{file.deletions ?? 0} lines
                                </text>
                              }
                            >
                              <DiffView
                                diff={file.diff}
                                filePath={file.path}
                                width={input.transcriptWidth}
                                style={shellContext.diffStyle()}
                                wrapMode={shellContext.diffWrapMode()}
                                theme={input.theme}
                              />
                            </Show>
                          </box>
                        )}
                      </For>
                    </box>
                  </Show>
                </scrollbox>
                <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
                  <text fg={input.theme.textMuted}>Tool: {entry().toolName}</text>
                  <text fg={input.theme.textMuted}>Effects: {entry().effects.join(", ")}</text>
                </box>
              </Show>
            </box>
          }
          actions={[
            {
              label: "Allow once",
              active: true,
              onSelect: () => {
                void input.controller.handleSemanticInput({
                  key: "enter",
                  ctrl: false,
                  meta: false,
                  shift: false,
                });
              },
            },
            {
              label: "Reject",
              onSelect: () => {
                void input.controller.handleSemanticInput({
                  key: "character",
                  text: "r",
                  ctrl: false,
                  meta: false,
                  shift: false,
                });
              },
            },
          ]}
          hints={[
            hasPreviewBody()
              ? `ctrl+f ${input.payload.previewExpanded ? "minimize" : "fullscreen"}`
              : "",
            "⇆ select",
            "enter confirm",
            "r reject",
            "esc close",
          ].filter(Boolean)}
        />
      )}
    </Show>
  );
}

export function InlineQuestionPrompt(input: {
  controller: CliShellController;
  payload: CliQuestionOverlayPayload;
  theme: SessionPalette;
}) {
  const question = createMemo(() => input.payload.snapshot.questions[input.payload.selectedIndex]);
  const total = createMemo(() => input.payload.snapshot.questions.length);
  return (
    <Show
      when={question()}
      fallback={
        <InlinePromptCard
          title="Questions"
          theme={input.theme}
          accentColor={input.theme.borderActive}
          body={
            <box paddingLeft={1} flexDirection="column" gap={1}>
              <text fg={input.theme.text}>No open questions.</text>
              <text fg={input.theme.textMuted}>
                Brewva will show delegated questions here when a run needs your input.
              </text>
            </box>
          }
          actions={[]}
          hints={["esc close"]}
        />
      }
    >
      {(entry) => (
        <InlinePromptCard
          title="Question"
          theme={input.theme}
          accentColor={input.theme.warning}
          header={
            <box flexDirection="column" gap={1}>
              <Show when={total() > 1}>
                <box flexDirection="row" gap={1}>
                  <For each={input.payload.snapshot.questions}>
                    {(_candidate, index) => (
                      <PromptActionChip
                        label={`Q${index() + 1}`}
                        active={index() === input.payload.selectedIndex}
                        theme={input.theme}
                      />
                    )}
                  </For>
                </box>
              </Show>
              <box flexDirection="row" gap={1}>
                <text fg={input.theme.warning}>△</text>
                <text fg={input.theme.text}>Question</text>
              </box>
            </box>
          }
          body={
            <box paddingLeft={1} flexDirection="column" gap={1}>
              <text fg={input.theme.text}>{entry().questionText}</text>
              <text fg={input.theme.textMuted}>{entry().sourceLabel}</text>
              <Show when={entry().delegate}>
                <text fg={input.theme.textMuted}>delegate={entry().delegate}</text>
              </Show>
              <Show when={entry().runId}>
                <text fg={input.theme.textMuted}>runId={entry().runId}</text>
              </Show>
            </box>
          }
          actions={[
            {
              label: "Prefill answer",
              active: true,
              onSelect: () => {
                void input.controller.handleSemanticInput({
                  key: "enter",
                  ctrl: false,
                  meta: false,
                  shift: false,
                });
              },
            },
          ]}
          hints={["enter answer", total() > 1 ? "j/k switch" : "", "esc close"].filter(Boolean)}
        />
      )}
    </Show>
  );
}
