import type { ClipboardOsc52Writer } from "./clipboard.js";
import { copyTextToClipboard } from "./clipboard.js";

type NotificationLevel = "info" | "warning" | "error";

export interface OpenTuiSelection {
  getSelectedText(): string;
}

export interface OpenTuiSelectionRenderer extends ClipboardOsc52Writer {
  getSelection?(): OpenTuiSelection | null;
  clearSelection?(): void;
}

export interface CopySelectionNotifier {
  notify(message: string, level?: NotificationLevel): void;
}

export type ClipboardCopy = (text: string) => Promise<void>;

function formatClipboardError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Failed to copy selection: ${error.message}`;
  }
  return "Failed to copy selection.";
}

export async function copyTextWithShellFeedback(input: {
  text: string;
  renderer?: OpenTuiSelectionRenderer;
  copyText?: ClipboardCopy;
  notifier: CopySelectionNotifier;
}): Promise<boolean> {
  if (!input.text) {
    return false;
  }
  try {
    const copyText =
      input.copyText ?? ((text: string) => copyTextToClipboard(text, { renderer: input.renderer }));
    await copyText(input.text);
    input.notifier.notify("Copied to clipboard.", "info");
    return true;
  } catch (error) {
    input.notifier.notify(formatClipboardError(error), "error");
    return false;
  } finally {
    input.renderer?.clearSelection?.();
  }
}

export async function copyOpenTuiSelection(input: {
  renderer?: OpenTuiSelectionRenderer;
  copyText?: ClipboardCopy;
  notifier: CopySelectionNotifier;
}): Promise<boolean> {
  const text = input.renderer?.getSelection?.()?.getSelectedText() ?? "";
  return await copyTextWithShellFeedback({
    text,
    renderer: input.renderer,
    copyText: input.copyText,
    notifier: input.notifier,
  });
}
