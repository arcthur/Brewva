/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from "@opentui/solid";
import { Show, createMemo } from "solid-js";
import type { CliShellNotification } from "../../src/shell/state/index.js";
import { TOAST_Z_INDEX, resolveToastMaxWidth } from "./overlay-style.js";
import { SPLIT_BORDER_CHARS, type SessionPalette } from "./palette.js";
import { renderNotificationSummary } from "./utils.js";

export function ToastStrip(input: {
  notifications: readonly CliShellNotification[];
  theme: SessionPalette;
}) {
  const dimensions = useTerminalDimensions();
  const latest = createMemo(() => input.notifications.at(-1));
  const toastWidth = createMemo(() => resolveToastMaxWidth(dimensions().width));
  const message = createMemo(() =>
    latest() ? `${renderNotificationSummary(latest()!)} · Ctrl+N inbox` : "",
  );
  return (
    <Show when={latest()}>
      <box
        position="absolute"
        zIndex={TOAST_Z_INDEX}
        top={2}
        right={2}
        maxWidth={toastWidth()}
        border={["left", "right"]}
        customBorderChars={SPLIT_BORDER_CHARS}
        borderColor={
          latest()!.level === "error"
            ? input.theme.error
            : latest()!.level === "warning"
              ? input.theme.warning
              : input.theme.border
        }
        backgroundColor={input.theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text
          fg={
            latest()!.level === "error"
              ? input.theme.error
              : latest()!.level === "warning"
                ? input.theme.warning
                : input.theme.text
          }
          wrapMode="word"
          width="100%"
        >
          {message()}
        </text>
      </box>
    </Show>
  );
}
