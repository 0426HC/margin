import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Screenshots and a short video of Lock in, demo course only. Run with `npm run shots:lockin`; without SHOTS=1 these are skipped, so normal
// test runs never rewrite docs.
const DIR = path.join("docs", "screenshots", "lock-in");
test.skip(!process.env.SHOTS, "screenshots only with SHOTS=1");
test.describe.configure({ mode: "serial" });

const SIZE = { width: 1440, height: 900 };
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
let demo = "";

async function context(browser: Browser, storage: Record<string, string>, video?: boolean) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: Object.entries(storage).map(([name, value]) => ({ name, value })) }] },
    ...(video ? { recordVideo: { dir: path.join("test-results", "lock-in-video"), size: SIZE } } : {}),
  });
  return { ctx, page: await ctx.newPage() };
}
const seen = { "margin:lock-in-hint-seen": "1" };
const settle = async (page: Page, ms = 900) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(DIR, { recursive: true });
  demo = ((await (await request.post("/api/demo")).json()) as { id: string }).id;
  // nothing from other tests waiting in the corner
  await request.post(`/api/projects/${demo}/agent-tasks`, { data: {} });
});

test("the overview in normal mode and in lock in", async ({ browser }) => {
  const { ctx, page } = await context(browser, { ...seen, "margin:mode": "normal" });
  await page.goto(`/p/${demo}`);
  await settle(page, 1800);
  await page.screenshot({ path: path.join(DIR, "overview-normal-1440.png") });
  await page.getByRole("switch", { name: /^Lock(ed)? in$/ }).click();
  await expect(page.getByRole("region", { name: "Up next" })).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(DIR, "overview-lock-in-1440.png") });
  await ctx.close();
});

test("a layer page and the home page in lock in", async ({ browser }) => {
  const { ctx, page } = await context(browser, { ...seen, "margin:mode": "lock-in" });
  await page.goto(`/p/${demo}`);
  await settle(page);
  await page.getByRole("region", { name: "Up next" }).getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await page.screenshot({ path: path.join(DIR, "layer-lock-in-1440.png") });
  await page.goto("/");
  await settle(page);
  await page.screenshot({ path: path.join(DIR, "home-lock-in-1440.png") });
  await ctx.close();
});

test("the focus timer panel, and the stopwatch when time is up", async ({ browser }) => {
  const { ctx, page } = await context(browser, { ...seen, "margin:mode": "lock-in", "margin:focus-last-minutes": "25" });
  await page.goto(`/p/${demo}`);
  await settle(page);
  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(page.getByRole("dialog", { name: "Focus for how long?" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR, "timer-panel-1440.png") });
  await page.keyboard.press("Escape");
  // a 25-minute round that ends in two seconds
  await page.evaluate(() => localStorage.setItem("margin:focus-timer", JSON.stringify({ phase: "running", kind: "focus", minutes: 25, endsAt: Date.now() + 2000, totalMs: 25 * 60_000 })));
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Stopwatch" })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1200); // after the slide-in and the wobble
  await page.screenshot({ path: path.join(DIR, "stopwatch-note-1440.png") });
  await ctx.close();
});

test("the one-time hint", async ({ browser }) => {
  const { ctx, page } = await context(browser, {});
  await page.goto(`/p/${demo}`);
  await expect(page.getByRole("note", { name: "New: Lock in" })).toBeVisible();
  await settle(page, 1800);
  await page.screenshot({ path: path.join(DIR, "hint-1440.png") });
  await ctx.close();
});

test("video: switching lock in on and off", async ({ browser }) => {
  const { ctx, page } = await context(browser, { ...seen, "margin:mode": "normal" }, true);
  await page.goto(`/p/${demo}`);
  await settle(page, 2200);
  await page.getByRole("switch", { name: /^Lock(ed)? in$/ }).click();
  await page.waitForTimeout(2200);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(800);
  await page.getByRole("switch", { name: /^Lock(ed)? in$/ }).click();
  await page.waitForTimeout(2600);
  const video = page.video()!;
  await ctx.close();
  await video.saveAs(path.join(DIR, "lock-in-switch.webm"));
});
