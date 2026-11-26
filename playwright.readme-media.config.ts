import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// The README's extra screenshots and the raw clips behind its GIFs (tests/e2e/readme-media.spec.ts), from the demo course only, on a
// production build with the real engine (the agents' document is a real answer). Its own throwaway data folder.
// README_MEDIA_KEEP=1 reuses the data folder of the last run (to record a few clips again). README_MEDIA=1 npx playwright test -c playwright.readme-media.config.ts   (then scripts/readme-gifs.mjs turns the clips into GIFs)
const port = 3201;
const dataDir = path.join(os.tmpdir(), "margin-readme-media-data");
if (process.env.TEST_WORKER_INDEX === undefined && process.env.README_MEDIA_KEEP !== "1") {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /readme-media\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  webServer: {
    command: `npx next build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { MARGIN_DATA_DIR: dataDir, MARGIN_BACKGROUND: "off", MARGIN_DIST_DIR: ".next-readme-media" },
  },
});
