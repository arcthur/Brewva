import type { SessionOpenQuestion } from "@brewva/brewva-gateway";
import type { BrewvaReplaySession, BrewvaRuntime } from "@brewva/brewva-runtime";
import type {
  DecideEffectCommitmentInput,
  PendingEffectCommitmentRequest,
} from "@brewva/brewva-runtime";
import type { DelegationRunRecord } from "@brewva/brewva-runtime";
import type {
  BrewvaManagedPromptSession,
  BrewvaPromptOptions,
  BrewvaPromptSessionEvent,
  BrewvaToolUiPort,
} from "@brewva/brewva-substrate";
import type { BrewvaSessionResult } from "../session.js";

export interface CliShellSessionBundle {
  session: BrewvaManagedPromptSession;
  runtime: BrewvaRuntime;
  orchestration?: BrewvaSessionResult["orchestration"];
}

export interface SessionViewPort {
  session: BrewvaManagedPromptSession;
  getSessionId(): string;
  getModelLabel(): string;
  getThinkingLevel(): string;
  prompt(text: string, options?: BrewvaPromptOptions): Promise<void>;
  waitForIdle(): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: BrewvaPromptSessionEvent) => void): () => void;
  getTranscriptSeed(): unknown[];
}

export interface OperatorSurfaceSnapshot {
  approvals: PendingEffectCommitmentRequest[];
  questions: SessionOpenQuestion[];
  taskRuns: DelegationRunRecord[];
  sessions: BrewvaReplaySession[];
}

export interface OperatorSurfacePort {
  getSnapshot(): Promise<OperatorSurfaceSnapshot>;
  decideApproval(requestId: string, input: DecideEffectCommitmentInput): Promise<void>;
  answerQuestion(questionId: string, answerText: string): Promise<void>;
  stopTask(runId: string): Promise<void>;
  openSession(sessionId: string): Promise<CliShellSessionBundle>;
  createSession(): Promise<CliShellSessionBundle>;
}

export interface CliApprovalOverlayPayload {
  kind: "approval";
  selectedIndex: number;
  snapshot: OperatorSurfaceSnapshot;
}

export interface CliQuestionOverlayPayload {
  kind: "question";
  selectedIndex: number;
  snapshot: OperatorSurfaceSnapshot;
}

export interface CliTasksOverlayPayload {
  kind: "tasks";
  selectedIndex: number;
  snapshot: OperatorSurfaceSnapshot;
}

export interface CliSessionsOverlayPayload {
  kind: "sessions";
  selectedIndex: number;
  sessions: BrewvaReplaySession[];
  currentSessionId: string;
  draftStateBySessionId: Record<
    string,
    {
      characters: number;
      lines: number;
      preview: string;
    }
  >;
}

export interface CliOverlayNotification {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: number;
}

export interface CliNotificationsOverlayPayload {
  kind: "notifications";
  selectedIndex: number;
  notifications: CliOverlayNotification[];
}

export interface CliOverlaySection {
  id: string;
  title: string;
  lines: string[];
}

export interface CliPagerOverlayPayload {
  kind: "pager";
  title?: string;
  lines: string[];
  scrollOffset: number;
}

export interface CliInspectOverlayPayload {
  kind: "inspect";
  lines: string[];
  sections: CliOverlaySection[];
  selectedIndex: number;
  scrollOffsets: number[];
}

export interface CliConfirmOverlayPayload {
  kind: "confirm";
  message: string;
  resolve(value: boolean): void;
}

export interface CliInputOverlayPayload {
  kind: "input";
  message?: string;
  value: string;
  resolve(value: string | undefined): void;
}

export interface CliSelectOverlayPayload {
  kind: "select";
  options: string[];
  selectedIndex: number;
  resolve(value: string | undefined): void;
}

export type CliShellOverlayPayload =
  | CliApprovalOverlayPayload
  | CliQuestionOverlayPayload
  | CliTasksOverlayPayload
  | CliSessionsOverlayPayload
  | CliNotificationsOverlayPayload
  | CliPagerOverlayPayload
  | CliInspectOverlayPayload
  | CliConfirmOverlayPayload
  | CliInputOverlayPayload
  | CliSelectOverlayPayload;

export interface SlashCommandEntry {
  command: string;
  description: string;
}

export interface WorkspaceCompletionPort {
  listSlashCommands(): readonly SlashCommandEntry[];
  listPaths(prefix: string): string[];
}

export interface ShellConfigPort {
  getEditorCommand(): string | undefined;
}

export interface CliShellUiPort extends BrewvaToolUiPort {}
