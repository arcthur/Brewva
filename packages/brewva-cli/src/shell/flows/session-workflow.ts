import { recordSessionShutdownIfMissing } from "@brewva/brewva-gateway";
import type { BrewvaPromptContentPart } from "@brewva/brewva-substrate";
import {
  buildCliShellPromptContentParts,
  cloneCliShellPromptParts,
  expandPromptTextParts,
} from "../prompt-parts.js";
import type { ShellCommitInput, ShellCommitOptions, ShellEffect } from "../shell-actions.js";
import type { CliShellAction, CliShellViewState } from "../state/index.js";
import { buildTextTranscriptMessage } from "../transcript.js";
import type {
  CliShellPromptPart,
  CliShellPromptSnapshot,
  CliShellSessionBundle,
  CliShellUiPort,
  SessionViewPort,
} from "../types.js";

interface PromptMemoryDelegate {
  appendHistory(entry: CliShellPromptSnapshot): void;
}

interface TranscriptProjectorDelegate {
  clearCorrectionMarker(sessionId: string): void;
  appendMessage(message: ReturnType<typeof buildTextTranscriptMessage>): void;
  setCorrectionMarker(text: string): void;
  refreshFromSession(): void;
}

interface ModelSelectionDelegate {
  openModelsDialog(input?: { query?: string; providerFilter?: string }): Promise<void>;
}

interface ProviderAuthDelegate {
  openConnectDialog(query?: string): Promise<void>;
}

export interface ShellSessionWorkflowContext {
  cwd: string;
  getState(): CliShellViewState;
  getBundle(): CliShellSessionBundle;
  getSessionPort(): SessionViewPort;
  getSessionGeneration(): number;
  getUi(): CliShellUiPort;
  promptMemory: PromptMemoryDelegate;
  transcriptProjector: TranscriptProjectorDelegate;
  modelSelection: ModelSelectionDelegate;
  providerAuth: ProviderAuthDelegate;
  commit(input: ShellCommitInput, options?: ShellCommitOptions): void;
  runShellEffects(effects: readonly ShellEffect[]): Promise<void>;
  handleShellCommand(prompt: string): Promise<boolean>;
  buildSessionStatusActions(): CliShellAction[];
  dismissPendingInteractiveQuestionRequests(input?: { sessionId?: string }): void;
  mountSession(bundle: CliShellSessionBundle): void;
  initializeState(): void;
  refreshOperatorSnapshot(): Promise<void>;
}

export class ShellSessionWorkflow {
  readonly #draftsBySessionId = new Map<
    string,
    {
      text: string;
      cursor: number;
      parts: CliShellPromptPart[];
      updatedAt: number;
    }
  >();
  #interactiveTurnSequence = 0;
  #preserveComposerAfterShellCommand = false;

  constructor(private readonly context: ShellSessionWorkflowContext) {}

  getDraftsBySessionId(): ReadonlyMap<
    string,
    {
      text: string;
      cursor: number;
      parts: CliShellPromptPart[];
      updatedAt: number;
    }
  > {
    return this.#draftsBySessionId;
  }

  async submitComposer(): Promise<void> {
    const promptText = this.context.getState().composer.text;
    const promptParts = cloneCliShellPromptParts(this.context.getState().composer.parts);
    const prompt = promptText.trim();
    if (!prompt) {
      return;
    }
    if (!prompt.startsWith("/")) {
      const availableModels = await this.context.getSessionPort().listModels();
      if (!this.context.getBundle().session.model || availableModels.length === 0) {
        this.context
          .getUi()
          .notify(
            availableModels.length === 0
              ? "No connected model provider. Use /model to connect one."
              : "No model selected. Use /model to choose one.",
            "warning",
          );
        if (availableModels.length === 0) {
          await this.context.providerAuth.openConnectDialog();
        } else {
          await this.context.modelSelection.openModelsDialog();
        }
        return;
      }
    }

    this.context.promptMemory.appendHistory({
      text: promptText,
      parts: promptParts,
    });
    this.#preserveComposerAfterShellCommand = false;
    const handled = await this.context.handleShellCommand(prompt);
    if (handled) {
      if (!this.#preserveComposerAfterShellCommand) {
        this.context.commit({
          type: "composer.setText",
          text: "",
          cursor: 0,
        });
      }
      this.#preserveComposerAfterShellCommand = false;
      return;
    }

    type CorrectionPromptParts = NonNullable<
      Parameters<SessionViewPort["recordCorrectionCheckpoint"]>[0]["prompt"]
    >["parts"];
    this.context.getSessionPort().recordCorrectionCheckpoint({
      turnId: `interactive:${Date.now()}:${++this.#interactiveTurnSequence}`,
      prompt: {
        text: promptText,
        parts: structuredClone(promptParts) as unknown as CorrectionPromptParts,
      },
    });
    this.context.transcriptProjector.clearCorrectionMarker(
      this.context.getSessionPort().getSessionId(),
    );
    this.context.commit(this.context.buildSessionStatusActions(), { debounceStatus: false });
    this.context.transcriptProjector.appendMessage(
      buildTextTranscriptMessage({
        id: `user:${Date.now()}`,
        role: "user",
        text: expandPromptTextParts(promptText, promptParts).trim(),
      }),
    );
    this.context.commit({
      type: "composer.setText",
      text: "",
      cursor: 0,
    });
    await this.context.runShellEffects([
      {
        type: "session.prompt",
        sessionGeneration: this.context.getSessionGeneration(),
        parts: buildCliShellPromptContentParts(
          this.context.cwd,
          promptText,
          promptParts,
        ) as readonly BrewvaPromptContentPart[],
        options: {
          source: "interactive",
          streamingBehavior: this.context.getBundle().session.isStreaming ? "followUp" : undefined,
        },
      },
    ]);
  }

  async undoLastCorrection(): Promise<void> {
    if (this.context.getBundle().session.isStreaming) {
      await this.context.getSessionPort().abort();
      await this.context.getSessionPort().waitForIdle();
    }
    const result = this.context.getSessionPort().undoCorrection();
    if (!result.ok) {
      this.context.getUi().notify(`Undo unavailable (${result.reason}).`, "warning");
      return;
    }
    this.context.transcriptProjector.setCorrectionMarker(
      `Correction undo applied: reverted ${result.patchSetIds.length} patch set(s) and restored the submitted prompt. Use /redo to restore the undone turn.`,
    );
    this.context.transcriptProjector.refreshFromSession();
    if (result.restoredPrompt) {
      this.context.commit(
        {
          type: "composer.setPromptState",
          text: result.restoredPrompt.text,
          cursor: result.restoredPrompt.text.length,
          parts: cloneCliShellPromptParts(
            result.restoredPrompt.parts as unknown as CliShellPromptPart[],
          ),
        },
        { debounceStatus: false },
      );
      this.#preserveComposerAfterShellCommand = true;
    }
    this.context
      .getUi()
      .notify(
        `Undid ${result.patchSetIds.length} patch set(s); prompt restored for correction.`,
        "info",
      );
    this.context.commit(this.context.buildSessionStatusActions(), { debounceStatus: false });
  }

  async redoLastCorrection(): Promise<void> {
    if (this.context.getBundle().session.isStreaming) {
      this.context.getUi().notify("Cannot redo while agent is running.", "warning");
      return;
    }
    const result = this.context.getSessionPort().redoCorrection();
    if (!result.ok) {
      this.context.getUi().notify(`Redo unavailable (${result.reason}).`, "warning");
      return;
    }
    this.context.transcriptProjector.setCorrectionMarker(
      `Correction redo applied: restored the undone turn and reapplied ${result.patchSetIds.length} patch set(s).`,
    );
    this.context.transcriptProjector.refreshFromSession();
    this.context.commit(
      {
        type: "composer.setText",
        text: "",
        cursor: 0,
      },
      { debounceStatus: false },
    );
    this.context.getUi().notify(`Redid ${result.patchSetIds.length} patch set(s).`, "info");
    this.context.commit(this.context.buildSessionStatusActions(), { debounceStatus: false });
  }

  async switchBundle(bundle: CliShellSessionBundle): Promise<void> {
    this.snapshotCurrentDraft();
    this.context.dismissPendingInteractiveQuestionRequests({
      sessionId: this.context.getSessionPort().getSessionId(),
    });
    try {
      recordSessionShutdownIfMissing(this.context.getBundle().runtime, {
        sessionId: this.context.getSessionPort().getSessionId(),
        reason: "cli_shell_session_switch",
        source: "cli_shell_runtime",
      });
    } catch {
      // best effort terminal receipt for session switching
    }
    this.context.getBundle().session.dispose();
    this.context.mountSession(bundle);
    this.context.initializeState();
    this.context
      .getUi()
      .notify(
        `Session started: ${this.context.getSessionPort().getSessionId()} (${this.context.getSessionPort().getModelLabel()})`,
        "info",
      );
    await this.context.refreshOperatorSnapshot();
  }

  private snapshotCurrentDraft(): void {
    const sessionId = this.context.getSessionPort().getSessionId();
    const text = this.context.getState().composer.text;
    if (text.trim().length === 0) {
      this.#draftsBySessionId.delete(sessionId);
      return;
    }
    this.#draftsBySessionId.set(sessionId, {
      text,
      cursor: this.context.getState().composer.cursor,
      parts: cloneCliShellPromptParts(this.context.getState().composer.parts),
      updatedAt: Date.now(),
    });
  }
}
