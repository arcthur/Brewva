import process from "node:process";
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing";
import { act, type ReactNode } from "react";
import type { Root } from "./reconciler/renderer.js";

export { act };

const ACT_WARNING_TEXT = "The current testing environment is not configured to support act(...)";
let actWarningFilterCount = 0;
let restoreConsoleError: (() => void) | undefined;
let restoreStdoutWrite: (() => void) | undefined;
let restoreStderrWrite: (() => void) | undefined;

function installActWarningFilter(): void {
  if (actWarningFilterCount === 0) {
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes(ACT_WARNING_TEXT)) {
        return;
      }
      originalConsoleError(...args);
    };
    restoreConsoleError = () => {
      console.error = originalConsoleError;
    };
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
            : "";
      if (text.includes(ACT_WARNING_TEXT)) {
        return true;
      }
      return originalStdoutWrite(
        chunk as Parameters<typeof process.stdout.write>[0],
        ...(args as Parameters<typeof process.stdout.write> extends [unknown, ...infer TRest]
          ? TRest
          : never),
      );
    }) as typeof process.stdout.write;
    restoreStdoutWrite = () => {
      process.stdout.write = originalStdoutWrite;
    };
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString("utf8")
            : "";
      if (text.includes(ACT_WARNING_TEXT)) {
        return true;
      }
      return originalStderrWrite(
        chunk as Parameters<typeof process.stderr.write>[0],
        ...(args as Parameters<typeof process.stderr.write> extends [unknown, ...infer TRest]
          ? TRest
          : never),
      );
    }) as typeof process.stderr.write;
    restoreStderrWrite = () => {
      process.stderr.write = originalStderrWrite;
    };
  }
  actWarningFilterCount += 1;
}

function removeActWarningFilter(): void {
  actWarningFilterCount = Math.max(0, actWarningFilterCount - 1);
  if (actWarningFilterCount === 0) {
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    restoreStdoutWrite?.();
    restoreStdoutWrite = undefined;
    restoreStderrWrite?.();
    restoreStderrWrite = undefined;
  }
}

function setIsReactActEnvironment(isReactActEnvironment: boolean) {
  const actGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    eval?: (source: string) => unknown;
  };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = isReactActEnvironment;
  const globalBindingExpression =
    typeof actGlobal.IS_REACT_ACT_ENVIRONMENT === "undefined"
      ? `var IS_REACT_ACT_ENVIRONMENT = ${isReactActEnvironment ? "true" : "false"};`
      : `IS_REACT_ACT_ENVIRONMENT = ${isReactActEnvironment ? "true" : "false"};`;
  actGlobal.eval?.(globalBindingExpression);
}

export async function testRender(node: ReactNode, testRendererOptions: TestRendererOptions) {
  let root: Root | null = null;
  setIsReactActEnvironment(true);
  installActWarningFilter();
  const { createRoot } = await import("./reconciler/renderer.js");

  const testSetup = await createTestRenderer({
    ...testRendererOptions,
    onDestroy() {
      act(() => {
        if (root) {
          root.unmount();
          root = null;
        }
      });
      testRendererOptions.onDestroy?.();
      removeActWarningFilter();
    },
  });

  root = createRoot(testSetup.renderer);
  act(() => {
    if (root) {
      root.render(node);
    }
  });

  const originalRenderOnce = testSetup.renderOnce.bind(testSetup);
  testSetup.renderOnce = async () => {
    await act(async () => {
      await originalRenderOnce();
    });
  };

  const originalDestroy = testSetup.renderer.destroy.bind(testSetup.renderer);
  testSetup.renderer.destroy = () => {
    act(() => {
      originalDestroy();
    });
  };

  const originalPressKey = testSetup.mockInput.pressKey.bind(testSetup.mockInput);
  testSetup.mockInput.pressKey = (key, modifiers) => {
    act(() => {
      originalPressKey(key, modifiers);
    });
  };

  return testSetup;
}
