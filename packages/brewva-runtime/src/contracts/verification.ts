import type { VerificationLevel } from "./shared.js";

export interface VerificationReport {
  passed: boolean;
  readOnly: boolean;
  skipped: boolean;
  reason?: "read_only";
  level: VerificationLevel;
  missingEvidence: string[];
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "skip";
    evidence?: string;
  }>;
}

export interface VerificationCheckRun {
  timestamp: number;
  ok: boolean;
  command: string;
  exitCode: number | null;
  durationMs: number;
  ledgerId?: string;
  outputSummary?: string;
}

export interface VerificationSessionState {
  lastWriteAt?: number;
  checkRuns: Record<string, VerificationCheckRun>;
  denialCount: number;
  lastOutcomeAt?: number;
  lastOutcomeLevel?: VerificationLevel;
  lastOutcomePassed?: boolean;
  lastOutcomeReferenceWriteAt?: number;
}
