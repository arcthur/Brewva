export type ShellMainAreaMode = "single" | "rail" | "stacked";
export type ShellOverlayVariant = "dialog" | "queue" | "pager" | "inspector";

export interface ShellLayoutInput {
  width: number;
  height: number;
  hasWidgets: boolean;
  headerLines: number;
  footerLines: number;
  notificationVisible: boolean;
  statusDetailLines: number;
}

export interface ShellLayout {
  mainArea: {
    mode: ShellMainAreaMode;
    widgetWidth: number;
    transcriptWidth: number;
    widgetGap: number;
  };
  composer: {
    boxHeight: number;
    textareaHeight: number;
  };
  statusBarHeight: number;
  transcriptViewportFallbackHeight: number;
}

export interface CompletionOverlayLayoutInput {
  width: number;
  height: number;
  composerTop: number;
  title: string;
  items: readonly string[];
}

export interface BoxLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

const RAIL_BREAKPOINT = 96;
const APP_HORIZONTAL_PADDING = 4;
const RAIL_GAP = 1;
const MIN_RAIL_WIDTH = 24;
const MAX_RAIL_WIDTH = 32;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function computeShellLayout(input: ShellLayoutInput): ShellLayout {
  const width = Math.max(40, input.width);
  const height = Math.max(16, input.height);
  const composer = {
    boxHeight: 5,
    textareaHeight: 3,
  };
  const statusBarHeight = 1;

  let mode: ShellMainAreaMode = "single";
  let widgetWidth = 0;
  let transcriptWidth = width;

  if (input.hasWidgets && width >= RAIL_BREAKPOINT) {
    mode = "rail";
    widgetWidth = clamp(Math.floor(width * 0.23), MIN_RAIL_WIDTH, MAX_RAIL_WIDTH);
    transcriptWidth = Math.max(44, width - APP_HORIZONTAL_PADDING - widgetWidth);
  } else if (input.hasWidgets) {
    mode = "stacked";
    widgetWidth = width;
    transcriptWidth = width;
  }

  const reservedLines =
    input.headerLines +
    input.footerLines +
    composer.boxHeight +
    statusBarHeight +
    input.statusDetailLines +
    (input.notificationVisible ? 2 : 0) +
    4;

  return {
    mainArea: {
      mode,
      widgetWidth,
      transcriptWidth,
      widgetGap: input.hasWidgets ? RAIL_GAP : 0,
    },
    composer,
    statusBarHeight,
    transcriptViewportFallbackHeight: Math.max(6, height - reservedLines),
  };
}

export function computeCompletionOverlayLayout(input: CompletionOverlayLayoutInput): BoxLayout {
  const visibleItems = input.items.slice(0, 6);
  const contentLines = visibleItems.length + 1;
  const overlayHeight = clamp(contentLines + 4, 6, Math.min(8, input.height - 2));
  const overlayWidth = clamp(
    Math.max(input.title.length, ...visibleItems.map((item) => item.length + 2)) + 6,
    28,
    Math.min(52, input.width - 4),
  );
  return {
    left: 2,
    top: Math.max(1, input.composerTop - overlayHeight - 1),
    width: overlayWidth,
    height: overlayHeight,
  };
}

export function computeOverlaySurfaceLayout(input: {
  width: number;
  height: number;
  variant: ShellOverlayVariant;
}): BoxLayout {
  const widthRatioByVariant: Record<ShellOverlayVariant, number> = {
    dialog: 0.62,
    queue: 0.72,
    pager: 0.82,
    inspector: 0.88,
  };
  const minWidthByVariant: Record<ShellOverlayVariant, number> = {
    dialog: 48,
    queue: 56,
    pager: 64,
    inspector: 72,
  };
  const heightRatioByVariant: Record<ShellOverlayVariant, number> = {
    dialog: 0.54,
    queue: 0.68,
    pager: 0.76,
    inspector: 0.82,
  };
  const minHeightByVariant: Record<ShellOverlayVariant, number> = {
    dialog: 12,
    queue: 14,
    pager: 16,
    inspector: 18,
  };

  const width = clamp(
    Math.floor(input.width * widthRatioByVariant[input.variant]),
    minWidthByVariant[input.variant],
    input.width - 4,
  );
  const height = clamp(
    Math.floor(input.height * heightRatioByVariant[input.variant]),
    minHeightByVariant[input.variant],
    input.height - 2,
  );

  return {
    width,
    height,
    left: Math.max(2, Math.floor((input.width - width) / 2)),
    top: Math.max(1, Math.floor((input.height - height) / 2)),
  };
}
