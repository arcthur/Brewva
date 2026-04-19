import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cut_for_search as cutForSearch, initSync } from "jieba-wasm/web";

export interface TokenizeSearchTextOptions {
  minLength?: number;
  includeCompoundSubtokens?: boolean;
  includeCjkNgrams?: boolean;
}

const ASCII_TOKEN_PATTERN = /[a-z0-9][a-z0-9._/-]*/gu;
const CJK_RUN_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]+/gu;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const ASCII_PATH_SPLIT_PATTERN = /[/.]+/u;
const ASCII_WORD_SPLIT_PATTERN = /[_-]+/u;
const DEFAULT_ASCII_MIN_LENGTH = 2;
const CJK_MIN_LENGTH = 2;
const CJK_NGRAM_SIZES = [2, 3] as const;
const JIEBA_WASM_FILENAME = "jieba_rs_wasm_bg.wasm";
const requireFromModule = createRequire(import.meta.url);

let jiebaInitialized = false;

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function containsCjk(value: string): boolean {
  return CJK_PATTERN.test(value);
}

export function tokenizeSearchText(
  value: string,
  options: TokenizeSearchTextOptions = {},
): string[] {
  ensureJiebaInitialized();
  const normalized = normalizeSearchText(value);
  const minLength = Math.max(1, Math.floor(options.minLength ?? DEFAULT_ASCII_MIN_LENGTH));
  const includeCompoundSubtokens = options.includeCompoundSubtokens ?? true;
  const includeCjkNgrams = options.includeCjkNgrams ?? true;
  const tokens: string[] = [];
  const seen = new Set<string>();

  const addToken = (token: string, minimumLength: number): void => {
    const normalizedToken = token.trim();
    if (normalizedToken.length < minimumLength || seen.has(normalizedToken)) {
      return;
    }
    seen.add(normalizedToken);
    tokens.push(normalizedToken);
  };

  for (const match of normalized.matchAll(ASCII_TOKEN_PATTERN)) {
    const token = match[0];
    addToken(token, minLength);
    if (!includeCompoundSubtokens) {
      continue;
    }
    for (const pathSegment of token.split(ASCII_PATH_SPLIT_PATTERN)) {
      addToken(pathSegment, minLength);
      for (const wordSegment of pathSegment.split(ASCII_WORD_SPLIT_PATTERN)) {
        addToken(wordSegment, minLength);
      }
    }
  }

  for (const match of normalized.matchAll(CJK_RUN_PATTERN)) {
    const run = match[0];
    for (const token of cutCjkRunForSearch(run)) {
      addToken(token, CJK_MIN_LENGTH);
    }
    if (!includeCjkNgrams) {
      continue;
    }
    for (const ngram of buildCjkNgrams(run)) {
      addToken(ngram, CJK_MIN_LENGTH);
    }
  }

  return tokens;
}

function cutCjkRunForSearch(value: string): string[] {
  return cutForSearch(value, true);
}

function ensureJiebaInitialized(): void {
  if (jiebaInitialized) {
    return;
  }
  const wasmPath = resolveJiebaWasmPath();
  initSync({ module: readFileSync(wasmPath) });
  jiebaInitialized = true;
}

function resolveJiebaWasmPath(): string {
  for (const candidate of listJiebaWasmPathCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `jieba-wasm asset is missing. Expected ${JIEBA_WASM_FILENAME} beside the Brewva binary or in the jieba-wasm package.`,
  );
}

function listJiebaWasmPathCandidates(): string[] {
  const candidates = [join(dirname(process.execPath), JIEBA_WASM_FILENAME)];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), JIEBA_WASM_FILENAME));
  } catch {
    // Some bundled runtimes expose non-file import.meta.url values.
  }
  try {
    candidates.push(
      join(dirname(requireFromModule.resolve("jieba-wasm/web")), JIEBA_WASM_FILENAME),
    );
  } catch {
    // The explicit failure happens in resolveJiebaWasmPath after all candidates are exhausted.
  }
  return candidates;
}

function buildCjkNgrams(value: string): string[] {
  const chars = Array.from(value);
  const ngrams: string[] = [];
  for (const size of CJK_NGRAM_SIZES) {
    if (chars.length < size) {
      continue;
    }
    for (let index = 0; index <= chars.length - size; index += 1) {
      ngrams.push(chars.slice(index, index + size).join(""));
    }
  }
  return ngrams;
}
