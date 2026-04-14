function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function readMessageRole(message: unknown): string | undefined {
  const record = asRecord(message);
  return typeof record?.role === "string" ? record.role : undefined;
}

export function readMessageStopReason(message: unknown): string | undefined {
  const record = asRecord(message);
  return typeof record?.stopReason === "string" ? record.stopReason : undefined;
}

export function extractMessageError(message: unknown): string | undefined {
  const record = asRecord(message);
  return typeof record?.errorMessage === "string" && record.errorMessage.trim().length > 0
    ? record.errorMessage.trim()
    : undefined;
}

export function extractVisibleTextFromMessage(message: unknown): string {
  const record = asRecord(message);
  if (!record) {
    return "";
  }

  const directContent = record.content;
  if (typeof directContent === "string") {
    return directContent;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (!Array.isArray(directContent)) {
    return "";
  }

  const segments: string[] = [];
  for (const part of directContent) {
    if (typeof part === "string") {
      segments.push(part);
      continue;
    }
    const contentPart = asRecord(part);
    if (!contentPart) {
      continue;
    }
    if (typeof contentPart.text === "string") {
      segments.push(contentPart.text);
      continue;
    }
    const nested = asRecord(contentPart.content);
    if (nested && typeof nested.text === "string") {
      segments.push(nested.text);
    }
  }
  const visibleText = segments.join("");
  if (visibleText.length > 0) {
    return visibleText;
  }
  return extractMessageError(record) ?? "";
}
