import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The README's extra screenshots and the raw clips behind its GIFs, from the demo course only. Not a test: off unless README_MEDIA=1, and run
 * with playwright.readme-media.config.ts. Screenshots go to docs/readme/*.jpg; each clip is a .webm plus its start offset in
 * <tmp>/margin-readme-media/clips, which scripts/readme-gifs.mjs turns into GIFs.
 */
test.skip(process.env.README_MEDIA !== "1", "README_MEDIA=1 records the README's media");
test.describe.configure({ mode: "serial" });

const OUT = path.join("docs", "readme");
const CLIPS = path.join(os.tmpdir(), "margin-readme-media", "clips");
const VIEWPORT = { width: 1440, height: 900 };
// a student who has already seen the one-time hints, so nothing sits over the page
const SEEN = { cookies: [], origins: [{ origin: "http://localhost:3201", localStorage: [{ name: "margin:lock-in-hint-seen", value: "1" }, { name: "margin:weeks-hint-seen", value: "1" }] }] };

let id = "";

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // entrances settle
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 85 });
}

/** Record one clip: `setup` loads and settles the page (not recorded in the GIF), `play` is what the GIF shows. */
async function clip(browser: Browser, name: string, setup: (p: Page) => Promise<void>, play: (p: Page) => Promise<void>) {
  fs.mkdirSync(CLIPS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(CLIPS, "raw-"));
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, storageState: SEEN, recordVideo: { dir, size: VIEWPORT } });
  // the "While you were away" card (from the agents' document made for the screenshots) would sit over every scene, so the clips leave it out
  await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ".wa{display:none!important}"; document.head.appendChild(st); }));
  const page = await context.newPage();
  const t0 = Date.now();
  await setup(page);
  const start = (Date.now() - t0) / 1000;
  await play(page);
  const end = (Date.now() - t0) / 1000;
  const video = page.video()!;
  await context.close();
  fs.copyFileSync(await video.path(), path.join(CLIPS, `${name}.webm`));
  fs.writeFileSync(path.join(CLIPS, `${name}.json`), JSON.stringify({ start, duration: end - start }));
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Scroll the window smoothly from where it is to `to` over `ms`, as a person's wheel would (ease in and out). */
const glide = (page: Page, to: number, ms: number) =>
  page.evaluate(
    ([target, dur]) =>
      new Promise<void>((resolve) => {
        const from = scrollY;
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          scrollTo(0, from + (target - from) * e);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [to, ms] as const,
  );

const tab = async (page: Page, name: string) => {
  await page.goto(`/p/${id}?tab=${name}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
};

test.beforeEach(async ({ request }) => {
  id = ((await (await request.post("/api/demo")).json()) as { id: string }).id; // the same demo each time it is asked for
});

test("the demo, and two saved write-ups for Note to Self", async ({ page, request }) => {
  await page.goto(`/p/${id}/talk`);
  await page.locator('a[href*="/l/"]').first().waitFor();
  const links = await page.locator('a[href*="/l/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("/l/")[1]));
  const layers = [...new Set(links)].slice(0, 3);
  expect(layers.length).toBeGreaterThan(0);
  for (const layer of layers) {
    const r = await request.post(`/api/layers/${layer}/submit`, {
      data: { text: "Publius says the debate over the Constitution matters because Americans get to show whether a people can choose good government by reflection and choice, instead of having it fall on them by accident and force. If they choose badly, it is a loss for everyone." },
      timeout: 300_000,
    });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await request.post(`/api/layers/${layer}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" }, timeout: 120_000 });
  }
});

test("screenshots: home, a new course, Lecture notes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, storageState: SEEN });
  const page = await context.newPage();
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto("/");
  await page.waitForTimeout(2500);
  const tile = page.locator(`.ho-tile[data-project-id="${id}"]`);
  await tile.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(1500);
  await shoot(page, "home-normal");
  await page.goto("/new");
  await shoot(page, "new-course-normal");
  await tab(page, "lecture-notes");
  const scene = page.getByRole("region", { name: "Lecture notes" });
  const b = (await scene.locator(".art-weeks-sheets").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  // walk the sheets until a week stands in front (not between two), so the week number reads whole
  const when = scene.locator(".art-weeks-when");
  for (let i = 0; i < 20 && !/^week 2 of \d+$/i.test(((await when.textContent()) ?? "").trim()); i++) {
    await page.mouse.wheel(0, 22);
    await page.waitForTimeout(250);
  }
  await expect(when).toHaveText(/^week 2 of \d+$/i);
  await page.waitForTimeout(800);
  await shoot(page, "lecture-notes-normal");
  await context.close();
});

test("screenshots: the agents' round table, both sides", async ({ browser, request }) => {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, storageState: SEEN });
  const page = await context.newPage();
  await page.goto(`/p/${id}?tab=layers`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Leave a note for the agents" }).click();
  const panel = page.getByRole("dialog", { name: "The agents" });
  await expect(panel).toBeVisible();
  await panel.getByRole("group", { name: "Suggestions" }).getByRole("button").first().click();
  await shoot(page, "agents-leave-a-note-normal");
  await panel.getByRole("button", { name: "Send to the agents" }).click();
  await expect(panel.getByRole("status").filter({ hasText: /Sent to the/ })).toBeVisible();
  await panel.getByRole("tab", { name: /Ready for you/ }).click();
  await expect(panel.getByRole("list").getByRole("button", { name: "Open" }).first()).toBeVisible({ timeout: 240_000 });
  await panel.getByRole("list").getByRole("button", { name: "Open" }).first().click();
  await expect(panel.locator(".ap-cite").first()).toBeVisible();
  // the "While you were away" card sits behind the open panel (inert), so its close button is pressed from the page itself
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".wa .wa-x")?.click());
  await shoot(page, "agents-ready-normal");
  await context.close();
  // the finished document is deleted again and its update marked seen, so no "While you were away" card sits over the clips that follow
  const list = (await (await request.get(`/api/projects/${id}/agent-requests`)).json()) as { requests?: { id: string }[] } | { id: string }[];
  for (const r of Array.isArray(list) ? list : (list.requests ?? [])) await request.delete(`/api/agent-requests/${r.id}`);
  await request.post(`/api/projects/${id}/agent-tasks`, { data: {} }); // and the agents' updates are marked seen
});

test("the demo's exam, read from its sheet, so the Exam room scene has its sheet", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  const demoExam = page.getByRole("button", { name: "Try the demo exam" });
  if (await demoExam.count()) {
    await demoExam.click({ timeout: 30_000 });
    await expect(demoExam).toHaveCount(0, { timeout: 120_000 });
  }
});

test("clip: the Layers tab, from the opening scene through the weeks", async ({ browser }) => {
  await clip(browser, "hero",
    async (p) => { await p.goto(`/p/${id}?tab=layers`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(2500); },
    async (p) => {
      const stops = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ov-scene")].slice(0, 3).map((s) => s.offsetTop + s.offsetHeight - innerHeight));
      await p.waitForTimeout(900);
      await glide(p, Math.max(0, stops[0]), 2200);
      await p.waitForTimeout(700);
      await glide(p, stops[1], 2000);
      await p.waitForTimeout(700);
      await glide(p, stops[2] ?? stops[1] + 900, 2000);
      await p.waitForTimeout(400);
    });
});

test("clips: Let's talk!, the Exam room, Lecture notes, Note to Self", async ({ browser }) => {
  await clip(browser, "talk", async (p) => { await p.goto("/"); }, async (p) => { await tab(p, "talk"); await p.waitForTimeout(5500); });
  await clip(browser, "exam", async (p) => { await p.goto("/"); }, async (p) => { await tab(p, "exam"); await p.waitForTimeout(6500); });
  await clip(browser, "lecture-notes",
    async (p) => { await tab(p, "lecture-notes"); },
    async (p) => {
      const b = (await p.getByRole("region", { name: "Lecture notes" }).locator(".art-weeks-sheets").boundingBox())!;
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await p.waitForTimeout(700);
      for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 28); await p.waitForTimeout(110); }
      await p.waitForTimeout(900);
      for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 28); await p.waitForTimeout(110); }
      await p.waitForTimeout(900);
      for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, -28); await p.waitForTimeout(110); }
      await p.waitForTimeout(900);
    });
  await clip(browser, "note-to-self", async (p) => { await p.goto("/"); }, async (p) => { await tab(p, "note-to-self"); await p.waitForTimeout(5500); });
});

test("clip: flipping Lock in on and off", async ({ browser }) => {
  await clip(browser, "lock-in",
    async (p) => { await p.goto(`/p/${id}?tab=layers`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(2500); },
    async (p) => {
      const sw = p.getByRole("switch", { name: /^Lock(ed)? in$/ });
      await p.waitForTimeout(800);
      await sw.click();
      await p.waitForTimeout(2200);
      await sw.click();
      await p.waitForTimeout(2200);
    });
});
