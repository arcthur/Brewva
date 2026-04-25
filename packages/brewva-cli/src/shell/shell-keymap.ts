import type { KeybindingDefinition } from "@brewva/brewva-tui";
import type { ShellKeybindingAction } from "./shell-actions.js";

const SHELL_ACTION_PREFIX = "shell:";

const key = (
  value: string,
  modifiers: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {},
) => ({
  key: value,
  ctrl: modifiers.ctrl === true,
  meta: modifiers.meta === true,
  shift: modifiers.shift === true,
});

export const shellBuiltInKeybindings: readonly KeybindingDefinition[] = [
  {
    id: "global.scrollUp",
    context: "global",
    trigger: key("pageup"),
    action: "shell:transcript.pageUp",
  },
  {
    id: "global.scrollDown",
    context: "global",
    trigger: key("pagedown"),
    action: "shell:transcript.pageDown",
  },
  {
    id: "global.scrollTop",
    context: "global",
    trigger: key("home"),
    action: "shell:transcript.top",
  },
  {
    id: "global.scrollBottom",
    context: "global",
    trigger: key("end"),
    action: "shell:transcript.bottom",
  },
  {
    id: "composer.submit",
    context: "composer",
    trigger: key("enter"),
    action: "shell:composer.submit",
  },
  {
    id: "composer.newline",
    context: "composer",
    trigger: key("j", { ctrl: true }),
    action: "shell:composer.newline",
  },
  {
    id: "completion.accept",
    context: "completion",
    trigger: key("tab"),
    action: "shell:completion.accept",
  },
  {
    id: "completion.acceptEnter",
    context: "completion",
    trigger: key("enter"),
    action: "shell:completion.submit",
  },
  {
    id: "completion.next",
    context: "completion",
    trigger: key("down"),
    action: "shell:completion.next",
  },
  {
    id: "completion.nextCtrlN",
    context: "completion",
    trigger: key("n", { ctrl: true }),
    action: "shell:completion.next",
  },
  {
    id: "completion.prev",
    context: "completion",
    trigger: key("up"),
    action: "shell:completion.previous",
  },
  {
    id: "completion.prevCtrlP",
    context: "completion",
    trigger: key("p", { ctrl: true }),
    action: "shell:completion.previous",
  },
  {
    id: "completion.dismiss",
    context: "completion",
    trigger: key("escape"),
    action: "shell:completion.dismiss",
  },
  {
    id: "overlay.close",
    context: "overlay",
    trigger: key("escape"),
    action: "shell:overlay.close",
  },
  {
    id: "overlay.select",
    context: "overlay",
    trigger: key("enter"),
    action: "shell:overlay.primary",
  },
  {
    id: "overlay.next",
    context: "overlay",
    trigger: key("down"),
    action: "shell:overlay.next",
  },
  {
    id: "overlay.nextCtrlN",
    context: "overlay",
    trigger: key("n", { ctrl: true }),
    action: "shell:overlay.next",
  },
  {
    id: "overlay.prev",
    context: "overlay",
    trigger: key("up"),
    action: "shell:overlay.previous",
  },
  {
    id: "overlay.prevCtrlP",
    context: "overlay",
    trigger: key("p", { ctrl: true }),
    action: "shell:overlay.previous",
  },
  {
    id: "overlay.pageDown",
    context: "overlay",
    trigger: key("pagedown"),
    action: "shell:overlay.pageDown",
  },
  {
    id: "overlay.pageUp",
    context: "overlay",
    trigger: key("pageup"),
    action: "shell:overlay.pageUp",
  },
  {
    id: "overlay.fullscreen",
    context: "overlay",
    trigger: key("f", { ctrl: true }),
    action: "shell:overlay.fullscreen",
  },
  {
    id: "pager.external",
    context: "pager",
    trigger: key("e", { ctrl: true }),
    action: "shell:pager.external",
  },
];

export function decodeShellKeybindingAction(action: string): ShellKeybindingAction {
  if (action.startsWith("command:")) {
    return {
      type: "command.run",
      commandId: action.slice("command:".length),
    };
  }
  if (!action.startsWith(SHELL_ACTION_PREFIX)) {
    return { type: "unknown", action };
  }
  const semantic = action.slice(SHELL_ACTION_PREFIX.length);
  switch (semantic) {
    case "composer.submit":
    case "composer.newline":
    case "completion.accept":
    case "completion.submit":
    case "completion.next":
    case "completion.previous":
    case "completion.dismiss":
    case "overlay.close":
    case "overlay.primary":
    case "overlay.next":
    case "overlay.previous":
    case "overlay.pageDown":
    case "overlay.pageUp":
    case "overlay.fullscreen":
    case "pager.external":
    case "transcript.pageUp":
    case "transcript.pageDown":
    case "transcript.top":
    case "transcript.bottom":
      return { type: semantic };
    default:
      return { type: "unknown", action };
  }
}

export function normalizeShellInputKey(inputKey: string): string {
  switch (inputKey.toLowerCase()) {
    case "return":
    case "linefeed":
      return "enter";
    case "arrowup":
    case "uparrow":
      return "up";
    case "arrowdown":
    case "downarrow":
      return "down";
    case "arrowleft":
    case "leftarrow":
      return "left";
    case "arrowright":
    case "rightarrow":
      return "right";
    case "pageup":
    case "page-up":
      return "pageup";
    case "pagedown":
    case "page-down":
      return "pagedown";
    default:
      return inputKey.toLowerCase();
  }
}
