import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// e2e gets its own port and its own throwaway data folder, so it can never touch your real projects.
// The port differs from `npm run dev` (3000), and we never reuse a server that is already running:
// reusing one would run the tests against whatever database that server was started with.
const port = Number(process.env.E2E_PORT ?? 3100);
const dataDir = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "margin-e2e-data");

// Config is loaded again inside every worker; only the main process may reset the folder.
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // specs share one demo project and one database; running files side by side made them step on each other
  retries: 1, // a few specs drive a dev server under load; one retry absorbs a slow hydration
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MARGIN_DATA_DIR: dataDir, MARGIN_ENGINE: "fake" }, // the fake engine answers instantly and offline
  },
});
