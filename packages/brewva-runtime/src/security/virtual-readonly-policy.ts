import type { CommandPolicyCommand, ShellCommandAnalysis } from "./command-policy.js";

export interface VirtualReadonlyBlockedReason {
  code: string;
  detail?: string;
  command?: string;
}

export interface VirtualReadonlyEligibility {
  readonlyGrammarEligible: boolean;
  eligible: boolean;
  materializedCandidates: string[];
  blockedReasons: VirtualReadonlyBlockedReason[];
}

export interface VirtualReadonlyPolicySummary {
  readonlyGrammarEligible: boolean;
  eligible: boolean;
  materializedCandidates: string[];
  blockedReasons: VirtualReadonlyBlockedReason[];
}

interface CommandMaterializationPlan {
  candidates: string[];
  requiresWorkspace: boolean;
}

interface ParsedArgv {
  positional: string[];
  pathOptionValues: string[];
  primaryOperandFromOption: boolean;
}

const COMMON_VALUE_FLAGS = new Set([
  "-A",
  "-B",
  "-C",
  "-m",
  "--after-context",
  "--before-context",
  "--context",
  "--max-count",
]);

const COMMAND_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  cut: new Set(["-b", "-c", "-d", "-f", "--bytes", "--characters", "--delimiter", "--fields"]),
  grep: new Set([...COMMON_VALUE_FLAGS, "-e", "-f", "--file", "--regexp"]),
  head: new Set(["-c", "-n", "--bytes", "--lines"]),
  jq: new Set(["-f", "-L", "--from-file", "--rawfile", "--slurpfile"]),
  rg: new Set([
    ...COMMON_VALUE_FLAGS,
    "-e",
    "-f",
    "-g",
    "-t",
    "-T",
    "--file",
    "--glob",
    "--max-depth",
    "--regexp",
    "--type",
    "--type-not",
  ]),
  sed: new Set(["-e", "-f", "--expression", "--file"]),
  tail: new Set(["-c", "-n", "-s", "--bytes", "--lines", "--sleep-interval"]),
};

const PRIMARY_OPERAND_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  grep: new Set(["-e", "-f", "--file", "--regexp"]),
  jq: new Set(["-f", "--from-file"]),
  rg: new Set(["-e", "-f", "--file", "--regexp"]),
  sed: new Set(["-e", "-f", "--expression", "--file"]),
};

const PATH_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  grep: new Set(["-f", "--file"]),
  jq: new Set(["-f", "--from-file"]),
  rg: new Set(["-f", "--file"]),
  sed: new Set(["-f", "--file"]),
};

function addReason(
  reasons: VirtualReadonlyBlockedReason[],
  reason: VirtualReadonlyBlockedReason,
): void {
  if (
    reasons.some(
      (entry) =>
        entry.code === reason.code &&
        entry.detail === reason.detail &&
        entry.command === reason.command,
    )
  ) {
    return;
  }
  reasons.push(reason);
}

function isLongFlagWithValue(arg: string, flag: string): boolean {
  return flag.startsWith("--") && arg.startsWith(`${flag}=`);
}

function isShortFlagWithAttachedValue(arg: string, flag: string): boolean {
  return (
    flag.startsWith("-") &&
    !flag.startsWith("--") &&
    arg.startsWith(flag) &&
    arg.length > flag.length
  );
}

function resolveAttachedOptionValue(arg: string, flag: string): string | undefined {
  if (isLongFlagWithValue(arg, flag)) {
    return arg.slice(flag.length + 1);
  }
  if (isShortFlagWithAttachedValue(arg, flag)) {
    return arg.slice(flag.length);
  }
  return undefined;
}

function parseArgv(command: string, argv: readonly string[]): ParsedArgv {
  const positional: string[] = [];
  const pathOptionValues: string[] = [];
  const valueFlags = COMMAND_VALUE_FLAGS[command] ?? new Set<string>();
  const primaryOperandFlags = PRIMARY_OPERAND_VALUE_FLAGS[command] ?? new Set<string>();
  const pathFlags = PATH_VALUE_FLAGS[command] ?? new Set<string>();
  let primaryOperandFromOption = false;
  let afterTerminator = false;

  const consumeOptionValue = (flag: string, value: string | undefined) => {
    if (primaryOperandFlags.has(flag)) {
      primaryOperandFromOption = true;
    }
    if (value && pathFlags.has(flag)) {
      pathOptionValues.push(value);
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!afterTerminator && arg === "--") {
      afterTerminator = true;
      continue;
    }

    if (!afterTerminator) {
      const exactValueFlag = [...valueFlags].find((flag) => arg === flag);
      if (exactValueFlag) {
        const value = argv[index + 1];
        consumeOptionValue(exactValueFlag, value);
        index += 1;
        continue;
      }

      const attachedValueFlag = [...valueFlags].find((flag) =>
        resolveAttachedOptionValue(arg, flag),
      );
      if (attachedValueFlag) {
        consumeOptionValue(attachedValueFlag, resolveAttachedOptionValue(arg, attachedValueFlag));
        continue;
      }

      if (arg.startsWith("-")) {
        continue;
      }
    }

    positional.push(arg);
  }

  return {
    positional,
    pathOptionValues,
    primaryOperandFromOption,
  };
}

function collectFindPathCandidates(argv: readonly string[]): string[] {
  const candidates: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-") || arg === "!" || arg === "(" || arg === ")" || arg === ",") {
      break;
    }
    candidates.push(arg);
  }
  return candidates.length > 0 ? candidates : ["."];
}

function collectSearchCandidates(
  command: "grep" | "rg",
  argv: readonly string[],
): CommandMaterializationPlan {
  const parsed = parseArgv(command, argv);
  const filesMode = command === "rg" && argv.includes("--files");
  const recursive =
    command === "grep" &&
    argv.some((arg) => arg === "-R" || arg === "-r" || /^-[A-Za-z]*[Rr]/u.test(arg));

  if (filesMode) {
    return {
      candidates: [...parsed.pathOptionValues, ...parsed.positional],
      requiresWorkspace: true,
    };
  }

  return {
    candidates: [
      ...parsed.pathOptionValues,
      ...(parsed.primaryOperandFromOption ? parsed.positional : parsed.positional.slice(1)),
    ],
    requiresWorkspace: command === "rg" || recursive,
  };
}

function collectVirtualReadonlyCommandCandidates(
  command: CommandPolicyCommand,
): CommandMaterializationPlan {
  const { name, argv } = command;

  if (name === "rg" || name === "grep") {
    return collectSearchCandidates(name, argv);
  }

  if (name === "find") {
    return {
      candidates: collectFindPathCandidates(argv),
      requiresWorkspace: true,
    };
  }

  if (name === "jq") {
    const parsed = parseArgv(name, argv);
    return {
      candidates: [
        ...parsed.pathOptionValues,
        ...(parsed.primaryOperandFromOption ? parsed.positional : parsed.positional.slice(1)),
      ],
      requiresWorkspace: false,
    };
  }

  if (name === "sed") {
    const parsed = parseArgv(name, argv);
    return {
      candidates: [
        ...parsed.pathOptionValues,
        ...(parsed.primaryOperandFromOption ? parsed.positional : parsed.positional.slice(1)),
      ],
      requiresWorkspace: false,
    };
  }

  if (name === "tr") {
    return {
      candidates: [],
      requiresWorkspace: false,
    };
  }

  if (name === "ls" || name === "du") {
    const parsed = parseArgv(name, argv);
    return {
      candidates: parsed.positional,
      requiresWorkspace: parsed.positional.length === 0,
    };
  }

  return {
    candidates: parseArgv(name, argv).positional,
    requiresWorkspace: false,
  };
}

function validateVirtualCandidate(
  command: string,
  candidate: string,
): VirtualReadonlyBlockedReason | undefined {
  if (
    candidate.length === 0 ||
    candidate === "." ||
    candidate === "./" ||
    candidate.startsWith("/") ||
    candidate.startsWith("~") ||
    /[*?[\]{}]/u.test(candidate)
  ) {
    return {
      code: "unsafe_virtual_readonly_path",
      detail: "Virtual readonly requires explicit non-glob relative path arguments.",
      command,
    };
  }

  const segments = candidate.split(/[\\/]+/u).filter(Boolean);
  if (segments.includes("..")) {
    return {
      code: "unsafe_virtual_readonly_path",
      detail: "Virtual readonly refuses parent-relative path arguments.",
      command,
    };
  }

  return undefined;
}

export function analyzeVirtualReadonlyEligibility(
  commandPolicy: ShellCommandAnalysis,
): VirtualReadonlyEligibility {
  const candidates = new Set<string>();
  const blockedReasons: VirtualReadonlyBlockedReason[] = [];

  if (!commandPolicy.readonlyEligible) {
    addReason(blockedReasons, {
      code: "shell_not_readonly_eligible",
      detail: "Shell command policy did not classify the command as readonly.",
    });
  }

  for (const command of commandPolicy.commands) {
    const commandPlan = collectVirtualReadonlyCommandCandidates(command);
    if (commandPlan.requiresWorkspace && commandPlan.candidates.length === 0) {
      addReason(blockedReasons, {
        code: "implicit_workspace_read",
        detail: "Virtual readonly requires explicit relative paths for workspace-wide commands.",
        command: command.name,
      });
    }

    for (const candidate of commandPlan.candidates) {
      const blockedReason = validateVirtualCandidate(command.name, candidate);
      if (blockedReason) {
        addReason(blockedReasons, blockedReason);
        continue;
      }
      candidates.add(candidate);
    }
  }

  return {
    readonlyGrammarEligible: commandPolicy.readonlyEligible,
    eligible: commandPolicy.readonlyEligible && blockedReasons.length === 0,
    materializedCandidates: [...candidates],
    blockedReasons,
  };
}

export function summarizeVirtualReadonlyEligibility(
  eligibility: VirtualReadonlyEligibility,
): VirtualReadonlyPolicySummary {
  return {
    readonlyGrammarEligible: eligibility.readonlyGrammarEligible,
    eligible: eligibility.eligible,
    materializedCandidates: [...eligibility.materializedCandidates],
    blockedReasons: eligibility.blockedReasons.map((reason) => ({ ...reason })),
  };
}
