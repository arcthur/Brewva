import { describe, expect, test } from "bun:test";
import { ShellCommandProvider } from "../../../packages/brewva-cli/src/shell/commands/command-provider.js";
import { registerShellCommands } from "../../../packages/brewva-cli/src/shell/commands/shell-command-registry.js";

describe("shell command provider", () => {
  test("derives visible and keybound command surfaces from registered commands", () => {
    const provider = new ShellCommandProvider();
    provider.register({
      id: "model.list",
      title: "Switch model",
      description: "Select a model.",
      category: "Agent",
      slash: { name: "models", aliases: ["model"], argumentMode: "optional" },
      keybinding: { key: "m", ctrl: true, meta: false, shift: false },
      suggested: true,
    });
    provider.register({
      id: "hidden.internal",
      title: "Hidden internal",
      category: "System",
      slash: { name: "hidden" },
      hidden: true,
    });
    provider.register({
      id: "disabled.command",
      title: "Disabled command",
      category: "System",
      slash: { name: "disabled" },
      keybinding: { key: "d", ctrl: true, meta: false, shift: false },
      enabled: false,
    });

    expect(provider.visibleCommands()).toMatchObject([
      {
        id: "model.list",
        slashName: "models",
        slashAliases: ["model"],
        description: "Select a model.",
      },
    ]);
    expect(provider.keyboundCommands()).toMatchObject([
      {
        id: "command.model.list",
        action: "command:model.list",
        context: "global",
      },
    ]);
  });

  test("search matches title, description, category, slash name, and slash aliases", () => {
    const provider = new ShellCommandProvider();
    provider.register({
      id: "operator.questions",
      title: "Operator questions",
      description: "Open the operator inbox for pending input.",
      category: "Operator",
      slash: { name: "questions", aliases: ["inbox"] },
    });

    expect(provider.searchCommands("operator").map((command) => command.id)).toEqual([
      "operator.questions",
    ]);
    expect(provider.searchCommands("pending").map((command) => command.id)).toEqual([
      "operator.questions",
    ]);
    expect(provider.searchCommands("/questions").map((command) => command.id)).toEqual([
      "operator.questions",
    ]);
    expect(provider.searchCommands("inbox").map((command) => command.id)).toEqual([
      "operator.questions",
    ]);
    expect(provider.searchCommands("opq").map((command) => command.id)).toEqual([
      "operator.questions",
    ]);
  });

  test("fails fast on duplicate ids, slash names, and keybindings", () => {
    const provider = new ShellCommandProvider();
    provider.register({
      id: "one",
      title: "One",
      category: "System",
      slash: { name: "one" },
      keybinding: { key: "k", ctrl: true, meta: false, shift: false },
    });

    expect(() =>
      provider.register({
        id: "one",
        title: "Duplicate id",
        category: "System",
      }),
    ).toThrow("Duplicate shell command id");
    expect(() =>
      provider.register({
        id: "two",
        title: "Duplicate slash",
        category: "System",
        slash: { name: "one" },
      }),
    ).toThrow("Duplicate shell command slash name");
    expect(() =>
      provider.register({
        id: "three",
        title: "Duplicate keybinding",
        category: "System",
        keybinding: { key: "k", ctrl: true, meta: false, shift: false },
      }),
    ).toThrow("Duplicate shell command keybinding");
  });

  test("hidden commands still create command intents by id", () => {
    const provider = new ShellCommandProvider();
    provider.register({
      id: "hidden.internal",
      title: "Hidden internal",
      category: "System",
      hidden: true,
    });

    expect(provider.visibleCommands()).toEqual([]);
    expect(provider.createCommandIntent("hidden.internal")).toEqual({
      type: "command.invoke",
      commandId: "hidden.internal",
      args: "",
      source: "internal",
    });
  });

  test("disabled commands fail closed explicitly", () => {
    const provider = new ShellCommandProvider();
    provider.register({
      id: "runtime.insights",
      title: "Insights",
      category: "Runtime",
      slash: { name: "insights", argumentMode: "optional" },
      enabled: false,
    });
    provider.register({
      id: "disabled.command",
      title: "Disabled",
      category: "System",
      enabled: false,
    });

    expect(
      provider.createSlashCommandIntent("insights", {
        args: "src",
        source: "slash",
      }),
    ).toBeUndefined();
    expect(provider.createCommandIntent("disabled.command")).toBeUndefined();
  });

  test("built-in registry keeps disabled runtime commands out of shell dispatch", () => {
    const provider = new ShellCommandProvider();
    registerShellCommands(provider);

    expect(provider.createCommandIntent("app.commandPalette")).toEqual({
      type: "command.invoke",
      commandId: "app.commandPalette",
      args: "",
      source: "internal",
    });
    expect(
      provider.createSlashCommandIntent("insights", {
        args: "workspace",
        source: "slash",
      }),
    ).toBeUndefined();
    expect(provider.visibleCommands().map((command) => command.id)).not.toContain(
      "runtime.insights",
    );
    expect(provider.searchCommands("insights")).toEqual([]);
    expect(
      provider.keyboundCommands().some((command) => command.action === "command:app.exit"),
    ).toBe(true);
  });
});
