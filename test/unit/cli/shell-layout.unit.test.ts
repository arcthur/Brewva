import { describe, expect, test } from "bun:test";
import {
  computeCompletionOverlayLayout,
  computeOverlaySurfaceLayout,
  computeShellLayout,
} from "../../../packages/brewva-cli/src/tui-app/shell-layout.js";

describe("shell layout", () => {
  test("keeps widgets in a right rail on wide terminals", () => {
    const layout = computeShellLayout({
      width: 140,
      height: 36,
      hasWidgets: true,
      headerLines: 1,
      footerLines: 1,
      notificationVisible: true,
      statusDetailLines: 2,
    });

    expect(layout.mainArea.mode).toBe("rail");
    expect(layout.mainArea.widgetWidth).toBe(32);
    expect(layout.mainArea.transcriptWidth).toBe(104);
    expect(layout.composer.boxHeight).toBe(5);
    expect(layout.composer.textareaHeight).toBe(3);
    expect(layout.statusBarHeight).toBe(1);
  });

  test("stacks widgets under the transcript on narrow terminals", () => {
    const layout = computeShellLayout({
      width: 80,
      height: 24,
      hasWidgets: true,
      headerLines: 0,
      footerLines: 0,
      notificationVisible: false,
      statusDetailLines: 0,
    });

    expect(layout.mainArea.mode).toBe("stacked");
    expect(layout.mainArea.widgetWidth).toBe(80);
    expect(layout.mainArea.transcriptWidth).toBe(80);
    expect(layout.mainArea.widgetGap).toBe(1);
    expect(layout.composer.boxHeight).toBe(5);
    expect(layout.transcriptViewportFallbackHeight).toBeGreaterThanOrEqual(6);
  });

  test("anchors completions above the composer without magic numbers", () => {
    const layout = computeCompletionOverlayLayout({
      width: 100,
      height: 28,
      composerTop: 20,
      title: "Completions (slash)",
      items: ["/inspect", "/install", "/init"],
    });

    expect(layout.left).toBe(2);
    expect(layout.top).toBe(11);
    expect(layout.width).toBe(28);
    expect(layout.height).toBe(8);
  });

  test("sizes overlays by variant instead of one hardcoded box", () => {
    const inspect = computeOverlaySurfaceLayout({
      width: 120,
      height: 36,
      variant: "inspector",
    });
    const queue = computeOverlaySurfaceLayout({
      width: 120,
      height: 36,
      variant: "queue",
    });

    expect(inspect.width).toBeGreaterThan(queue.width);
    expect(inspect.height).toBeGreaterThan(queue.height);
    expect(inspect.left).toBeGreaterThanOrEqual(2);
    expect(queue.top).toBeGreaterThanOrEqual(1);
  });
});
