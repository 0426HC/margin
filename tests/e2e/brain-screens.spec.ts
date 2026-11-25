import { expect, test, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { e2eDataDir, layerIdsOf, seedProject } from "./helpers";

// Screenshots of what Round 3 put on screen: the brain's progress and week marks on the course page, "Knows Weeks…" in Let's talk!, and
// the new Explained, its named ideas explained inside the sections, in normal mode and lock in, at 1440x900 and 1024 wide. Only with SHOTS=1 (to look at,
// not to compare); they go to test-results/brain-shots.
const DIR = path.join("test-results", "brain-shots");
test.skip(!process.env.SHOTS, "screenshots only with SHOTS=1");
test.describe.configure({ mode: "serial" });

const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const SIZES = { wide: { width: 1440, height: 900 }, narrow: { width: 1024, height: 768 } } as const;
let projectId = "";
let layerId = "";

/** As if the brain had read Week 1 and nothing after it: a read mark for each of its course files, and none for the other weeks'. */
function markWeekRead(id: string, week: number) {
  const db = new Database(path.join(e2eDataDir(), "margin.db"));
  const files = db.prepare("select id from files where project_id = ? and category = 'course' and week = ?").all(id, week) as { id: string }[];
  db.prepare("delete from brain_reads where project_id = ?").run(id);
  for (const f of files) db.prepare("insert or replace into brain_reads (file_id, project_id, status, notes, read_at) values (?, ?, 'read', 3, ?)").run(f.id, id, Date.now());
  db.close();
}

async function open(browser: Browser, mode: "normal" | "lock-in", size: keyof typeof SIZES) {
  const ctx = await browser.newContext({
    viewport: SIZES[size],
    storageState: { cookies: [], origins: [{ origin: ORIGIN, localStorage: [{ name: "margin:mode", value: mode }, { name: "margin:lock-in-hint-seen", value: "1" }, { name: "margin:weeks-hint-seen", value: "1" }] }] },
  });
  return { ctx, page: await ctx.newPage() };
}
const settle = async (page: Page, ms = 1200) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};

test.beforeAll(async ({ request, browser }) => {
  fs.mkdirSync(DIR, { recursive: true });
  projectId = await seedProject(request, "Brain screens", { courseCode: "POL101" });
  const { ctx, page } = await open(browser, "normal", "wide");
  layerId = (await layerIdsOf(page, projectId))[0];
  // write the first layer (the brain reads its file first, then the new Explained)
  const r = await request.post(`/api/layers/${layerId}/write`);
  expect(r.ok()).toBe(true);
  await r.text();
  await ctx.close();
  markWeekRead(projectId, 1);
});

for (const mode of ["normal", "lock-in"] as const)
  for (const size of ["wide", "narrow"] as const) {
    test(`course page, Let's talk! and Explained: ${mode}, ${size}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, mode, size);
      await page.goto(`/p/${projectId}`);
      await settle(page, 1800);
      await expect(page.locator(".ov-bar-brain")).toContainText(/read 1 of \d+ weeks/i, { useInnerText: true });
      await page.screenshot({ path: path.join(DIR, `course-${mode}-${size}.png`) });
      if (mode === "normal") {
        await page.getByText("Margin has read this week").first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.locator(".ov-kicker .read-mark").first().scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 1400);
        await settle(page, 1500);
        await page.screenshot({ path: path.join(DIR, `course-week-mark-${mode}-${size}.png`) });
      }
      await page.goto(`/p/${projectId}/talk`);
      await settle(page);
      await expect(page.getByText("Knows Week 1 so far")).toBeVisible();
      await page.screenshot({ path: path.join(DIR, `talk-${mode}-${size}.png`) });
      await page.goto(`/p/${projectId}/l/${layerId}`);
      await settle(page);
      await expect(page.getByText("The big question")).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(DIR, `explained-top-${mode}-${size}.png`) });
      await page.locator(".m-reading-pane:not([aria-busy]) .m-section:visible").nth(1).scrollIntoViewIfNeeded();
      await settle(page, 500);
      await page.screenshot({ path: path.join(DIR, `explained-section-${mode}-${size}.png`) });
      await ctx.close();
    });
  }
