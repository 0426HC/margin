import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// The README's visual tour (tests/e2e/readme-tour.spec.ts), from the demo course on a production build with the REAL Claude Code engine,
// so Let's talk!, the write-back review, the agents' document and the import's reasons are real answers. Its own throwaway data folder;
// uses your Claude plan for a few calls. Then `FFMPEG=/path/to/ffmpeg node scripts/readme-video.mjs` makes the optional video.
// README_TOUR_KEEP=1 reuses the data folder of the last run (to take a few shots again, with --grep). README_TOUR=1 npx playwright test -c playwright.readme.config.ts
const port = 3200;
const dataDir = path.join(os.tmpdir(), "margin-readme-tour");
if (process.env.TEST_WORKER_INDEX === undefined && process.env.README_TOUR_KEEP !== "1") {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /readme-tour\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npx next build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { MARGIN_DATA_DIR: dataDir, MARGIN_BACKGROUND: "off", MARGIN_DIST_DIR: ".next-readme" },
  },
});
