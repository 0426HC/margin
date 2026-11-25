import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// The README's screenshots (tests/e2e/readme-shots.spec.ts), on a production build with the REAL Claude Code engine, so Let's talk!, the
// write-back review and the import's reasons are real answers. Its own throwaway data folder; uses your Claude plan for a few calls.
// README_SHOTS=1 npx playwright test -c playwright.readme.config.ts
const port = 3200;
const dataDir = path.join(os.tmpdir(), "margin-readme-shots");
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /readme-shots\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  webServer: {
    command: `npx next build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { MARGIN_DATA_DIR: dataDir, MARGIN_BACKGROUND: "on", MARGIN_DIST_DIR: ".next-readme" },
  },
});
