import { wrapTextToLines } from "@brewva/brewva-tui";
import { marked, type Tokens } from "marked";

function renderInline(tokens: readonly Tokens.Generic[] | undefined): string {
  if (!tokens || tokens.length === 0) {
    return "";
  }

  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
        case "escape":
          return token.raw;
        case "codespan":
          return `\`${token.text}\``;
        case "strong":
          return renderInline(token.tokens);
        case "em":
          return renderInline(token.tokens);
        case "del":
          return renderInline(token.tokens);
        case "link": {
          const label = renderInline(token.tokens).trim();
          return label.length > 0 && label !== token.href ? `${label} (${token.href})` : token.href;
        }
        case "image":
          return token.text.trim().length > 0 ? `[image: ${token.text}]` : `[image: ${token.href}]`;
        case "br":
          return "\n";
        default:
          return "raw" in token && typeof token.raw === "string" ? token.raw : "";
      }
    })
    .join("");
}

function pushWrapped(target: string[], text: string, width: number, indent = ""): void {
  const wrapped = wrapTextToLines(text, Math.max(1, width - indent.length));
  if (wrapped.length === 0) {
    target.push(indent);
    return;
  }
  for (const line of wrapped) {
    target.push(`${indent}${line}`);
  }
}

function renderTokenLines(token: Tokens.Generic, width: number, target: string[], depth = 0): void {
  switch (token.type) {
    case "space":
      return;
    case "paragraph":
      pushWrapped(target, renderInline(token.tokens), width);
      return;
    case "heading":
      pushWrapped(target, `${"#".repeat(token.depth)} ${renderInline(token.tokens)}`, width);
      return;
    case "blockquote":
      for (const nested of token.tokens ?? []) {
        const nestedLines: string[] = [];
        renderTokenLines(nested, width - 2, nestedLines, depth + 1);
        for (const line of nestedLines) {
          target.push(line.length > 0 ? `│ ${line}` : "│");
        }
      }
      return;
    case "list":
      for (const [index, item] of token.items.entries()) {
        const bullet = token.ordered ? `${(token.start ?? 1) + index}. ` : "• ";
        const itemLines: string[] = [];
        for (const child of item.tokens) {
          renderTokenLines(child, width - bullet.length - depth * 2, itemLines, depth + 1);
        }
        if (itemLines.length === 0) {
          target.push(`${"  ".repeat(depth)}${bullet}`.trimEnd());
          continue;
        }
        target.push(`${"  ".repeat(depth)}${bullet}${itemLines[0]}`);
        for (const continuation of itemLines.slice(1)) {
          target.push(
            continuation.length > 0
              ? `${"  ".repeat(depth + 1)}${continuation}`
              : "  ".repeat(depth + 1).trimEnd(),
          );
        }
      }
      return;
    case "code": {
      const fence = token.lang?.trim().length ? `\`\`\`${token.lang}` : "```";
      target.push(fence);
      for (const line of token.text.split("\n")) {
        pushWrapped(target, line, width, "  ");
      }
      target.push("```");
      return;
    }
    case "hr":
      target.push("─".repeat(Math.max(3, Math.min(width, 32))));
      return;
    case "table": {
      const headers = token.header
        .map((cell: Tokens.TableCell) => renderInline(cell.tokens))
        .join(" | ");
      pushWrapped(target, headers, width);
      target.push("-".repeat(Math.max(3, Math.min(width, headers.length))));
      for (const row of token.rows) {
        pushWrapped(
          target,
          row.map((cell: Tokens.TableCell) => renderInline(cell.tokens)).join(" | "),
          width,
        );
      }
      return;
    }
    case "html":
      if (token.text.trim().length > 0) {
        pushWrapped(target, token.text, width);
      }
      return;
    case "text":
      pushWrapped(target, token.text, width);
      return;
    default:
      if ("raw" in token && typeof token.raw === "string" && token.raw.trim().length > 0) {
        pushWrapped(target, token.raw.trim(), width);
      }
  }
}

export function renderMarkdownToLines(text: string, width: number): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  const tokens = marked.lexer(normalized.replace(/\t/gu, "  "));
  for (const token of tokens) {
    const before = lines.length;
    renderTokenLines(token, width, lines);
    if (lines.length > before && token.type !== "list" && token.type !== "blockquote") {
      lines.push("");
    }
  }

  while (lines.length > 1 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length > 0 ? lines : [normalized];
}
