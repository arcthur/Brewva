import type { KeybindingContext, KeybindingResolver } from "@brewva/brewva-tui";
import type { ShellIntent } from "./shell-actions.js";
import { decodeShellKeybindingAction, normalizeShellInputKey } from "./shell-keymap.js";
import type { CliShellInput, CliShellOverlayPayload } from "./types.js";

export interface ShellInputRouterState {
  activeOverlayKind?: CliShellOverlayPayload["kind"];
  hasCompletion: boolean;
  canNavigatePromptHistoryPrevious: boolean;
  canNavigatePromptHistoryNext: boolean;
}

export type ShellInputRoute =
  | {
      handled: false;
    }
  | {
      handled: true;
      intent: ShellIntent;
    };

export function shellInputContexts(state: {
  activeOverlayKind?: CliShellOverlayPayload["kind"];
  hasCompletion: boolean;
}): KeybindingContext[] {
  if (state.activeOverlayKind === "pager") {
    return ["pager", "overlay", "global"];
  }
  if (state.activeOverlayKind) {
    return ["overlay", "global"];
  }
  if (state.hasCompletion) {
    return ["completion", "composer", "global"];
  }
  return ["composer", "global"];
}

function isPickerOverlay(kind: CliShellOverlayPayload["kind"] | undefined): boolean {
  return kind === "commandPalette" || kind === "modelPicker" || kind === "providerPicker";
}

export function routeShellInput(input: {
  input: CliShellInput;
  state: ShellInputRouterState;
  keybindings: KeybindingResolver;
}): ShellInputRoute {
  const overlayKind = input.state.activeOverlayKind;
  if (overlayKind === "input") {
    return {
      handled: true,
      intent: { type: "dialog.input", input: input.input },
    };
  }
  if (overlayKind === "question" && !input.input.ctrl && !input.input.meta) {
    return {
      handled: true,
      intent: { type: "question.input", input: input.input },
    };
  }

  const binding = input.keybindings.resolve(shellInputContexts(input.state), {
    key: normalizeShellInputKey(input.input.key),
    ctrl: input.input.ctrl,
    meta: input.input.meta,
    shift: input.input.shift,
  });
  if (binding) {
    return {
      handled: true,
      intent: {
        type: "keybinding.invoke",
        action: decodeShellKeybindingAction(binding.action),
      },
    };
  }

  if (isPickerOverlay(overlayKind)) {
    return {
      handled: true,
      intent: { type: "picker.input", input: input.input },
    };
  }
  if (overlayKind) {
    return {
      handled: true,
      intent: { type: "overlay.input", input: input.input },
    };
  }

  const key = normalizeShellInputKey(input.input.key);
  if (key === "up" && input.state.canNavigatePromptHistoryPrevious) {
    return {
      handled: true,
      intent: { type: "promptHistory.navigate", direction: -1 },
    };
  }
  if (key === "down" && input.state.canNavigatePromptHistoryNext) {
    return {
      handled: true,
      intent: { type: "promptHistory.navigate", direction: 1 },
    };
  }

  return { handled: false };
}
