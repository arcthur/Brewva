export interface BrewvaUiDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export type BrewvaUiThemeDescriptor = object;

export interface BrewvaUiThemeEntry {
  name: string;
  path?: string;
}

export interface BrewvaQuestionOption {
  label: string;
  description?: string;
}

export interface BrewvaQuestionPrompt {
  header: string;
  question: string;
  options: BrewvaQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface BrewvaQuestionAnswerSpec {
  question: string;
  options: readonly BrewvaQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface BrewvaInteractiveQuestionRequest {
  toolCallId: string;
  title?: string;
  questions: BrewvaQuestionPrompt[];
}

export type BrewvaThemeSelectionResult =
  | { success: true }
  | {
      success: false;
      error: string;
    };

function normalizeQuestionOption(value: BrewvaQuestionOption): BrewvaQuestionOption | null {
  const label = value.label.trim();
  if (!label) {
    return null;
  }
  const description = value.description?.trim();
  return description ? { label, description } : { label };
}

function normalizeQuestionAnswerSpec(
  value: BrewvaQuestionAnswerSpec,
): (BrewvaQuestionAnswerSpec & { multiple: boolean; custom: boolean }) | null {
  const question = value.question.trim();
  if (!question) {
    return null;
  }
  const options = value.options
    .map((option) => normalizeQuestionOption(option))
    .filter((option): option is BrewvaQuestionOption => option !== null);
  const multiple = value.multiple === true;
  const custom = value.custom !== false;
  if (options.length === 0 && !custom) {
    return null;
  }
  return {
    question,
    options,
    multiple,
    custom,
  };
}

export function normalizeQuestionPrompt(prompt: BrewvaQuestionPrompt): BrewvaQuestionPrompt | null {
  const header = prompt.header.trim();
  if (!header) {
    return null;
  }
  const normalized = normalizeQuestionAnswerSpec(prompt);
  if (!normalized) {
    return null;
  }
  return {
    header,
    question: normalized.question,
    options: [...normalized.options],
    ...(normalized.multiple ? { multiple: true } : {}),
    custom: normalized.custom,
  };
}

export function validateQuestionAnswers(input: {
  questions: readonly BrewvaQuestionAnswerSpec[];
  answers: readonly (readonly string[])[];
}):
  | {
      ok: true;
      answers: string[][];
    }
  | {
      ok: false;
      error: string;
    } {
  const normalizedQuestions = input.questions.map((question, index) => ({
    index,
    question: normalizeQuestionAnswerSpec(question),
  }));
  const invalidQuestion = normalizedQuestions.find((entry) => entry.question === null);
  if (invalidQuestion) {
    return {
      ok: false,
      error: `Question ${invalidQuestion.index + 1} is invalid or cannot be answered.`,
    };
  }
  if (input.answers.length !== normalizedQuestions.length) {
    return {
      ok: false,
      error: `Expected ${normalizedQuestions.length} answer set(s); received ${input.answers.length}.`,
    };
  }
  const answers: string[][] = [];
  for (const entry of normalizedQuestions) {
    const question = entry.question;
    if (!question) {
      continue;
    }
    const normalizedAnswers = Array.from(
      new Set(
        (input.answers[entry.index] ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (normalizedAnswers.length === 0) {
      return {
        ok: false,
        error: `Question ${entry.index + 1} is unanswered.`,
      };
    }
    if (!question.multiple && normalizedAnswers.length > 1) {
      return {
        ok: false,
        error: `Question ${entry.index + 1} accepts only one answer.`,
      };
    }
    if (!question.custom) {
      const allowedAnswers = new Set(question.options.map((option) => option.label));
      const invalidAnswer = normalizedAnswers.find((value) => !allowedAnswers.has(value));
      if (invalidAnswer) {
        return {
          ok: false,
          error: `Question ${entry.index + 1} does not allow custom answer '${invalidAnswer}'.`,
        };
      }
    }
    answers.push(normalizedAnswers);
  }
  return {
    ok: true,
    answers,
  };
}

export interface BrewvaToolUiPort {
  select(
    title: string,
    options: string[],
    opts?: BrewvaUiDialogOptions,
  ): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: BrewvaUiDialogOptions): Promise<boolean>;
  input(
    title: string,
    placeholder?: string,
    opts?: BrewvaUiDialogOptions,
  ): Promise<string | undefined>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  onTerminalInput(handler: (input: string) => unknown): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setHiddenThinkingLabel(label?: string): void;
  custom<T>(kind: string, payload: unknown, opts?: BrewvaUiDialogOptions): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  setEditorComponent(factory: unknown): void;
  readonly theme: BrewvaUiThemeDescriptor;
  getAllThemes(): BrewvaUiThemeEntry[];
  getTheme(name: string): BrewvaUiThemeDescriptor | undefined;
  setTheme(theme: string | BrewvaUiThemeDescriptor): BrewvaThemeSelectionResult;
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}
