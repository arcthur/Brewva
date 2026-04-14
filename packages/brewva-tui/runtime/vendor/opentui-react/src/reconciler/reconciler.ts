import type { RootRenderable } from "@opentui/core";
import React from "react";
import ReactReconciler from "react-reconciler";
import { ConcurrentRoot } from "react-reconciler/constants";
import { hostConfig } from "./host-config.js";

export const reconciler = ReactReconciler(hostConfig);
const ROOT_TAG = ConcurrentRoot as Parameters<typeof reconciler.createContainer>[1];

// Inject into DevTools - this is safe to call even if devtools isn't connected
// @ts-expect-error the types for `react-reconciler` are not up to date with the library.
reconciler.injectIntoDevTools();

export function _render(element: React.ReactNode, root: RootRenderable) {
  const container = reconciler.createContainer(
    root,
    ROOT_TAG,
    null,
    false,
    null,
    "",
    console.error,
    console.error,
    console.error,
    console.error,
    null,
  );

  reconciler.updateContainer(element, container, null, () => {});

  return container;
}
