import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  collectPlaneSessionDigests,
  shouldThrottlePlaneRefresh,
  writeFileAtomic,
} from "@brewva/brewva-deliberation";
import { createTestWorkspace } from "../../helpers/workspace.js";

describe("plane substrate", () => {
  test("collects stable session digests from event-like stores", () => {
    const digests = collectPlaneSessionDigests({
      listSessionIds: () => ["b", "a", "empty"],
      list: (sessionId) => {
        if (sessionId === "a") return [{ timestamp: 10 }, { timestamp: 20 }];
        if (sessionId === "b") return [{ timestamp: 5 }];
        return [];
      },
    });

    expect(digests).toEqual([
      { sessionId: "a", eventCount: 2, lastEventAt: 20 },
      { sessionId: "b", eventCount: 1, lastEventAt: 5 },
    ]);
  });

  test("throttles dirty refresh only inside the configured interval", () => {
    expect(
      shouldThrottlePlaneRefresh({
        currentUpdatedAt: 1_000,
        dirty: true,
        digestsChanged: false,
        minRefreshIntervalMs: 250,
        now: 1_100,
      }),
    ).toBe(true);
    expect(
      shouldThrottlePlaneRefresh({
        currentUpdatedAt: 1_000,
        dirty: true,
        digestsChanged: false,
        minRefreshIntervalMs: 250,
        now: 1_300,
      }),
    ).toBe(false);
    expect(
      shouldThrottlePlaneRefresh({
        currentUpdatedAt: 1_000,
        dirty: false,
        digestsChanged: false,
        minRefreshIntervalMs: 250,
        now: 1_100,
      }),
    ).toBe(false);
  });

  test("writes atomically without leaving fixed tmp artifacts behind", () => {
    const workspace = createTestWorkspace("plane-substrate-atomic-write");
    const filePath = resolve(workspace, ".brewva", "deliberation", "state.json");

    writeFileAtomic(filePath, '{\n  "schema": "one"\n}\n');
    writeFileAtomic(filePath, '{\n  "schema": "two"\n}\n');

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toContain('"schema": "two"');
    const directoryEntries = readdirSync(join(workspace, ".brewva", "deliberation"));
    expect(directoryEntries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });
});
