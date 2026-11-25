import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach } from "vitest";

afterEach(cleanup);

// No test may ever write into the real .data folder: every test file gets its own throwaway data folder (a test may still set its own).
const ownDataDir = process.env.MARGIN_DATA_DIR ? null : fs.mkdtempSync(path.join(os.tmpdir(), "margin-unit-"));
if (ownDataDir) process.env.MARGIN_DATA_DIR = ownDataDir;
afterAll(() => {
  if (ownDataDir) fs.rmSync(ownDataDir, { recursive: true, force: true });
});

// jsdom has no matchMedia or ResizeObserver; Motion and the workspace use both.
// Node-environment tests (parsers, database) have no window.
if (typeof window !== "undefined") {
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
}
