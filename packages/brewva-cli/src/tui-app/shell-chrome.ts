import type { TuiTheme } from "@brewva/brewva-tui";
import type { ShellOverlayVariant } from "./shell-layout.js";
import type { CliShellNotification, CliShellTranscriptEntry } from "./state/index.js";

export interface ShellChrome {
  appBackground: string;
  transcript: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    mutedTextColor: string;
  };
  railCard: {
    backgroundColor: string;
    borderColor: string;
    titleColor: string;
    textColor: string;
  };
  composer: {
    backgroundColor: string;
    borderColor: string;
    textareaBackgroundColor: string;
    textColor: string;
    placeholderColor: string;
  };
  completion: {
    backgroundColor: string;
    borderColor: string;
    titleColor: string;
    textColor: string;
    selectedBackgroundColor: string;
    selectedTextColor: string;
  };
  overlay: {
    backgroundColor: string;
    titleColor: string;
    borderColorByVariant: Record<ShellOverlayVariant, string>;
    detailBorderColor: string;
  };
  selectionList: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    selectedBackgroundColor: string;
    selectedTextColor: string;
  };
  status: {
    detailColor: string;
    barBorderColor: string;
    barTextColor: string;
    barMetaColor: string;
  };
  notification: {
    backgroundColor: string;
  };
}

export function roleTone(entry: CliShellTranscriptEntry, theme: TuiTheme): string {
  switch (entry.role) {
    case "assistant":
      return theme.accent;
    case "tool":
      return theme.warning;
    case "custom":
      return theme.textDim;
    case "system":
      return theme.textMuted;
    default:
      return theme.text;
  }
}

export function notificationTone(notification: CliShellNotification, theme: TuiTheme): string {
  switch (notification.level) {
    case "error":
      return theme.error;
    case "warning":
      return theme.warning;
    default:
      return theme.accent;
  }
}

export function overlayStatusLabel(kind: string): string {
  switch (kind) {
    case "approval":
      return "Approvals";
    case "question":
      return "Questions";
    case "tasks":
      return "Tasks";
    case "sessions":
      return "Sessions";
    case "notifications":
      return "Inbox";
    case "inspect":
      return "Inspect";
    case "pager":
      return "Pager";
    default:
      return "Dialog";
  }
}

export function createShellChrome(theme: TuiTheme): ShellChrome {
  return {
    appBackground: theme.backgroundApp,
    transcript: {
      backgroundColor: theme.backgroundPanel,
      borderColor: theme.borderSubtle,
      textColor: theme.text,
      mutedTextColor: theme.textMuted,
    },
    railCard: {
      backgroundColor: theme.backgroundPanel,
      borderColor: theme.borderSubtle,
      titleColor: theme.textMuted,
      textColor: theme.text,
    },
    composer: {
      backgroundColor: theme.backgroundPanel,
      borderColor: theme.borderActive,
      textareaBackgroundColor: theme.backgroundElement,
      textColor: theme.text,
      placeholderColor: theme.textDim,
    },
    completion: {
      backgroundColor: theme.backgroundElement,
      borderColor: theme.border,
      titleColor: theme.textMuted,
      textColor: theme.text,
      selectedBackgroundColor: theme.selectionBg,
      selectedTextColor: theme.selectionText,
    },
    overlay: {
      backgroundColor: theme.backgroundOverlay,
      titleColor: theme.text,
      borderColorByVariant: {
        dialog: theme.border,
        queue: theme.border,
        pager: theme.border,
        inspector: theme.borderActive,
      },
      detailBorderColor: theme.borderSubtle,
    },
    selectionList: {
      backgroundColor: theme.backgroundElement,
      borderColor: theme.borderSubtle,
      textColor: theme.text,
      selectedBackgroundColor: theme.selectionBg,
      selectedTextColor: theme.selectionText,
    },
    status: {
      detailColor: theme.textMuted,
      barBorderColor: theme.borderSubtle,
      barTextColor: theme.text,
      barMetaColor: theme.textMuted,
    },
    notification: {
      backgroundColor: theme.backgroundElement,
    },
  };
}
