import type { ShellCommand, ShellCommandProvider } from "./command-provider.js";

type RuntimeSlashCommand = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly name: string;
  readonly argumentMode?: "none" | "optional" | "required";
};

const builtInShellCommands: readonly ShellCommand[] = [
  {
    id: "app.commandPalette",
    title: "Open command palette",
    description: "Search and run available Brewva TUI actions.",
    category: "System",
    keybinding: { key: "k", ctrl: true, meta: false, shift: false },
    suggested: true,
  },
  {
    id: "app.help",
    title: "Help",
    description: "Open Brewva TUI help and discovery shortcuts.",
    category: "System",
    slash: { name: "help" },
    suggested: true,
  },
  {
    id: "app.exit",
    title: "Exit Brewva",
    description: "Exit the interactive shell.",
    category: "System",
    slash: { name: "quit", aliases: ["exit"], argumentMode: "none" },
    keybinding: { key: "q", ctrl: true, meta: false, shift: false },
  },
  {
    id: "app.abortOrExit",
    title: "Abort or exit",
    description: "Abort the current turn; exits when no turn is streaming.",
    category: "System",
    keybinding: { key: "c", ctrl: true, meta: false, shift: false },
  },
  {
    id: "composer.editor",
    title: "Open external editor",
    description: "Edit the current prompt in VISUAL or EDITOR.",
    category: "Composer",
    keybinding: { key: "e", ctrl: true, meta: false, shift: false },
  },
  {
    id: "session.new",
    title: "New session",
    description: "Create a new interactive session.",
    category: "Session",
    slash: { name: "new" },
  },
  {
    id: "session.list",
    title: "Switch session",
    description: "Browse and switch replay sessions.",
    category: "Session",
    slash: { name: "sessions" },
    keybinding: { key: "g", ctrl: true, meta: false, shift: false },
    suggested: true,
  },
  {
    id: "session.inspect",
    title: "Inspect session",
    description: "Replay-first inspect report for the current session.",
    category: "Session",
    slash: { name: "inspect" },
    keybinding: { key: "i", ctrl: true, meta: false, shift: false },
  },
  {
    id: "session.undo",
    title: "Undo last turn",
    description: "Undo the last submitted turn and restore its prompt.",
    category: "Session",
    slash: { name: "undo" },
  },
  {
    id: "session.redo",
    title: "Redo last turn",
    description: "Redo the last undone turn.",
    category: "Session",
    slash: { name: "redo" },
  },
  {
    id: "agent.models",
    title: "Switch model",
    description: "Select a model for the current session.",
    category: "Agent",
    slash: { name: "models", argumentMode: "optional" },
    suggested: true,
  },
  {
    id: "agent.connect",
    title: "Connect provider",
    description: "Connect a model provider.",
    category: "Agent",
    slash: { name: "connect", argumentMode: "optional" },
  },
  {
    id: "agent.think",
    title: "Select thinking level",
    description: "Select the model thinking level for future turns.",
    category: "Agent",
    slash: { name: "think" },
  },
  {
    id: "view.thinking",
    title: "Toggle thinking blocks",
    description: "Show or hide reasoning blocks in the transcript.",
    category: "View",
    slash: { name: "thinking" },
  },
  {
    id: "view.toolDetails",
    title: "Toggle tool details",
    description: "Show or hide completed tool details in the transcript.",
    category: "View",
    slash: { name: "tool-details" },
  },
  {
    id: "view.diffWrap",
    title: "Toggle diff wrapping",
    description: "Toggle wrapping in diff views.",
    category: "View",
    slash: { name: "diffwrap" },
  },
  {
    id: "view.diffStyle",
    title: "Toggle diff style",
    description: "Toggle automatic split diffs and stacked unified diffs.",
    category: "View",
    slash: { name: "diffstyle" },
  },
  {
    id: "operator.approvals",
    title: "Approvals",
    description: "Review queued approval requests.",
    category: "Operator",
    slash: { name: "approvals" },
    keybinding: { key: "a", ctrl: true, meta: false, shift: false },
  },
  {
    id: "operator.questions",
    title: "Operator questions",
    description: "Open the operator inbox for pending input.",
    category: "Operator",
    slash: { name: "questions" },
    keybinding: { key: "o", ctrl: true, meta: false, shift: false },
  },
  {
    id: "operator.tasks",
    title: "Tasks",
    description: "Inspect background task runs.",
    category: "Operator",
    slash: { name: "tasks" },
    keybinding: { key: "t", ctrl: true, meta: false, shift: false },
  },
  {
    id: "operator.notifications",
    title: "Notifications",
    description: "Open the operator notification inbox.",
    category: "Operator",
    slash: { name: "notifications", aliases: ["inbox"] },
    keybinding: { key: "n", ctrl: true, meta: false, shift: false },
  },
  {
    id: "operator.answer",
    title: "Answer operator question",
    description: "Answer a pending operator prompt.",
    category: "Operator",
    slash: { name: "answer", argumentMode: "required" },
  },
  {
    id: "system.theme",
    title: "Switch theme",
    description: "List or switch interactive shell themes.",
    category: "System",
    slash: { name: "theme", argumentMode: "optional" },
  },
  {
    id: "composer.stash",
    title: "Stash prompt",
    description: "Browse stashed prompt drafts.",
    category: "Composer",
    slash: { name: "stash", argumentMode: "optional" },
    keybinding: { key: "s", ctrl: true, meta: false, shift: false },
  },
  {
    id: "composer.unstash",
    title: "Restore latest stash",
    description: "Restore the latest stashed prompt.",
    category: "Composer",
    slash: { name: "unstash" },
    keybinding: { key: "y", ctrl: true, meta: false, shift: false },
  },
];

const runtimeSlashCommands: readonly RuntimeSlashCommand[] = [
  {
    id: "runtime.insights",
    title: "Insights",
    description: "Workspace-level insights without entering a model turn.",
    category: "Runtime",
    name: "insights",
    argumentMode: "optional",
  },
  {
    id: "runtime.agentOverlays",
    title: "Agent overlays",
    description: "Inspect authored agent overlays.",
    category: "Runtime",
    name: "agent-overlays",
    argumentMode: "optional",
  },
  {
    id: "runtime.update",
    title: "Update Brewva",
    description: "Queue Brewva update workflow.",
    category: "Runtime",
    name: "update",
  },
];

export function registerShellCommands(commandProvider: ShellCommandProvider): void {
  for (const command of builtInShellCommands) {
    commandProvider.register(command);
  }
  for (const command of runtimeSlashCommands) {
    commandProvider.register({
      id: command.id,
      title: command.title,
      description: command.description,
      category: command.category,
      slash: {
        name: command.name,
        argumentMode: command.argumentMode,
      },
      enabled: false,
    });
  }
}
