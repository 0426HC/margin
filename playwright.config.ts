import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// e2e gets its own port and its own throwaway data folder, so it can never touch your real projects.
// The port differs from `npm run dev` (3000), and we never reuse a server that is already running:
// reusing one would run the tests against whatever database that server was started with.
const port = Number(process.env.E2E_PORT ?? 3100);
const prod = process.env.E2E_PROD === "1";
const dataDir = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "margin-e2e-data");

// Config is loaded again inside every worker; only the main process may reset the folder.
// Every test starts as a student who has already seen the one-time hints (Lock in, and Layers or Weeks), so they never sit over the page;
// the hints' own tests open a context without this state.
const storageState = path.join(dataDir, "..", "margin-e2e-storage.json");
if (process.env.TEST_WORKER_INDEX === undefined) {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storageState, JSON.stringify({ cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: "margin:lock-in-hint-seen", value: "1" }, { name: "margin:weeks-hint-seen", value: "1" }] }] }));
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // specs share one demo project and one database; running files side by side made them step on each other
  retries: 1, // a few specs drive a dev server under load; one retry absorbs a slow hydration
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, storageState },
  // E2E_PROD=1 runs the same flows on a production build (next build + next start), as the Mac app serves it (docs/mac-app.md).
  webServer: {
    command: prod ? `npx next build && npx next start -p ${port}` : `npm run dev -- -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: prod ? 300_000 : 120_000,
    env: { MARGIN_DATA_DIR: dataDir, MARGIN_ENGINE: "fake", MARGIN_LAYER_IDLE_S: "12", MARGIN_BACKGROUND: process.env.E2E_BACKGROUND ?? "off", MARGIN_DIST_DIR: prod ? ".next-e2e-prod" : ".next-e2e" }, // the fake engine answers instantly and offline
  },
});
