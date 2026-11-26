import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

/**
 * The README's visual tour, from the demo course only (and its own sample folder for the import screen). Not a test: off unless
 * README_TOUR=1, and run with playwright.readme.config.ts (the real engine, a throwaway data folder). Writes the tour's stills,
 * docs/readme/NN-name.jpg in the order the README shows them, the Lock in grid (docs/readme/lock-in-*.jpg) and the frames of the
 * layers video (<tmp>/margin-readme-frames), which scripts/readme-video.mjs turns into readme-videos/layers-scroll.mp4.
 */
test.skip(process.env.README_TOUR !== "1", "README_TOUR=1 takes the README's tour");
test.describe.configure({ mode: "serial" });

const OUT = path.join("docs", "readme");
const FRAMES = path.join(os.tmpdir(), "margin-readme-frames");
const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const VIEWPORT = { width: 1440, height: 900 };
// a student who has already seen the one-time hints, so nothing sits over the page
const SEEN = {
  cookies: [],
  origins: [{ origin: "http://localhost:3200", localStorage: [{ name: "margin:lock-in-hint-seen", value: "1" }, { name: "margin:weeks-hint-seen", value: "1" }] }],
};
const QUALITY = 92;

let id = "";

async function shoot(page: Page, name: string, settle = 1500) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(settle); // entrances settle
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: QUALITY });
}
async function mode(page: Page, m: "normal" | "lock-in") {
  await page.evaluate((v) => localStorage.setItem("margin:mode", v), m);
}
async function fresh(browser: Browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, storageState: SEEN });
  return { context, page: await context.newPage() };
}
async function openTab(page: Page, name: string) {
  await page.goto(`/p/${id}?tab=${name}`); // a bare address would reopen the tab used last
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
}
/** The course's first layer, from the Let's talk! page (which lists the layers as links). */
async function firstLayerId(page: Page) {
  await page.goto(`/p/${id}/talk`);
  const link = page.locator('a[href*="/l/"]').first();
  await link.waitFor();
  return (await link.getAttribute("href"))!.split("/l/")[1];
}
async function clearAgentWork(request: APIRequestContext) {
  const list = (await (await request.get(`/api/projects/${id}/agent-requests`)).json()) as { ready?: { id: string }[] };
  for (const r of list.ready ?? []) await request.delete(`/api/agent-requests/${r.id}`);
  await request.post(`/api/projects/${id}/agent-tasks`, { data: {} }); // and the agents' updates are marked seen
}

test.beforeEach(async ({ request }) => {
  id = ((await (await request.post("/api/demo")).json()) as { id: string }).id; // the same demo each time it is asked for
  fs.mkdirSync(OUT, { recursive: true });
});

test("the demo's real work: saved write-ups for Note to Self, a question in Let's talk!", async ({ page, request }) => {
  await page.goto(`/p/${id}/talk`);
  await page.locator('a[href*="/l/"]').first().waitFor();
  const links = await page.locator('a[href*="/l/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("/l/")[1]));
  const layers = [...new Set(links)].slice(0, 3);
  expect(layers.length).toBeGreaterThan(0);
  const writeUps = [
    "Publius says the debate over the Constitution matters because Americans get to show whether a people can choose good government by reflection and choice, instead of having it fall on them by accident and force. If they choose badly, it is a loss for everyone.",
    "People on both sides of the argument speak from ambition and suspicion, so Publius asks readers to judge the arguments themselves and not the motives behind them. A good argument stays good even when the person making it has something to gain.",
    "Publius lists six topics the series will cover: how useful the Union is, how weak the present Confederation is, why the new government must be energetic, how well the plan fits republican government, how much it resembles the state constitutions, and how it protects liberty and property.",
  ];
  for (const [i, layer] of layers.entries()) {
    const r = await request.post(`/api/layers/${layer}/submit`, { data: { text: writeUps[i % writeUps.length] }, timeout: 300_000 });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await request.post(`/api/layers/${layer}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" }, timeout: 120_000 });
  }
  const ask = page.getByRole("textbox", { name: /Ask/ }).first();
  await ask.fill("Why does Madison think a large republic controls faction better than a small one?");
  await page.getByRole("button", { name: "Ask" }).first().click();
  const log = page.locator(".m-chat-list").first();
  await expect(log).toHaveAttribute("aria-busy", "true");
  await expect(log).toHaveAttribute("aria-busy", "false", { timeout: 300_000 }); // the answer has finished
});

test("the demo's exam, read from its sheet", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  const demoExam = page.getByRole("button", { name: "Try the demo exam" });
  await demoExam.click({ timeout: 30_000 });
  await expect(demoExam).toHaveCount(0, { timeout: 120_000 });
});

test("1-3: Margin's home page, the project list, the new project page", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await shoot(page, "01-home");
  const tile = page.locator(`.ho-tile[data-project-id="${id}"]`);
  await tile.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(1500);
  await shoot(page, "02-projects");
  await page.goto("/new");
  await shoot(page, "03-new-project");
  await context.close();
});

test("5-8: the opening scene, the round table idle and at work, the agents' panel", async ({ browser, request }) => {
  await clearAgentWork(request); // no "While you were away" card over the scene
  const { context, page } = await fresh(browser);
  await openTab(page, "layers");
  await page.waitForTimeout(3000);
  await shoot(page, "05-course", 300);
  await shoot(page, "06-round-table-idle", 4000); // the same scene once it has settled, the agents idle

  await page.getByRole("button", { name: "Leave a note for the agents" }).click();
  const panel = page.getByRole("dialog", { name: "The agents" });
  await expect(panel).toBeVisible();
  await panel.getByRole("group", { name: "Suggestions" }).getByRole("button").first().click();
  await shoot(page, "08a-agents-leave-a-note");
  await panel.getByRole("button", { name: "Send to the agents" }).click();
  await expect(panel.getByRole("status").filter({ hasText: /Sent to the/ })).toBeVisible();
  // the table at work: the panel closed, the agents seated while the note is being made
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator(".hall-agent[data-working]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3500);
  await shoot(page, "07-round-table-at-work", 0);

  // the document is finished: its update is marked seen and the page reloaded, so no "While you were away" card sits behind the panel
  await expect
    .poll(async () => ((await (await request.get(`/api/projects/${id}/agent-requests`)).json()) as { ready?: unknown[] }).ready?.length ?? 0, { timeout: 300_000 })
    .toBeGreaterThan(0);
  await request.post(`/api/projects/${id}/agent-tasks`, { data: {} });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Ready for you/ }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: /Ready for you/ }).click();
  const open = panel.getByRole("list").getByRole("button", { name: "Open" }).first();
  await expect(open).toBeVisible();
  await open.click();
  await expect(panel.locator(".ap-cite").first()).toBeVisible();
  await shoot(page, "08b-agents-ready");
  await context.close();
  await clearAgentWork(request);
});

test("9: the layers expanded, a week scene with its stacked sheets", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await openTab(page, "layers");
  await page.locator(".ov-scene").first().waitFor();
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".ov-scene")!;
    window.scrollTo(0, s.offsetTop + s.offsetHeight - innerHeight);
  });
  await shoot(page, "09-layers");
  await context.close();
});

test("10-14: a layer, Let's talk!, Lecture notes, Note to Self, the Exam room", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  const first = await firstLayerId(page);
  await page.goto(`/p/${id}/l/${first}`);
  await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 60_000 });
  await shoot(page, "10-layer-explained");
  // further down: a section answering its sub-question, each named idea explained where it matters, its pages in the margin
  await page.locator(".m-reading-pane:not([aria-busy]) .m-section:visible").nth(1).evaluate((el) => el.scrollIntoView({ block: "start" }));
  const bar = await page.locator(".m-reading-pane:not([aria-busy]) .m-bar:visible").evaluate((el) => el.getBoundingClientRect().height);
  await page.locator(".m-reading-pane:not([aria-busy]) .m-scroll:visible").evaluate((el, h) => el.scrollBy(0, -(h + 24)), bar);
  await shoot(page, "explained-section");

  await page.goto(`/p/${id}/talk`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  // the chat from its top: the question, then the answer's opening
  await page.locator(".m-chat-list").first().evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 5) n.scrollTop = 0;
  });
  await shoot(page, "11-talk", 600);

  await openTab(page, "lecture-notes");
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
  await shoot(page, "12-lecture-notes");

  await page.goto(`/p/${id}/notes`);
  await shoot(page, "13-note-to-self");
  await openTab(page, "exam");
  await shoot(page, "14-exam-room");
  await context.close();
});

test("15: Lock in, a small grid of its screens", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await page.goto("/");
  await mode(page, "lock-in");
  await page.goto(`/p/${id}?tab=layers`);
  await shoot(page, "lock-in-course");
  const first = await firstLayerId(page);
  await page.goto(`/p/${id}/l/${first}`);
  await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 60_000 });
  await shoot(page, "lock-in-explained");
  await page.goto(`/p/${id}/talk`);
  await shoot(page, "lock-in-talk");
  await page.goto(`/p/${id}/notes`);
  await shoot(page, "lock-in-note-to-self");
  await page.goto(`/p/${id}/exam`);
  await shoot(page, "lock-in-exam");
  await mode(page, "normal");
  await context.close();
});

test("4: the import page, the demo's own sample folder imported fresh", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-readme-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, folder, { recursive: true });
  await page.getByTestId("folder-input").setInputFiles(folder);
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/\/p\/[^/]+\/setup$/, { timeout: 600_000 });
  await expect(page.getByRole("heading", { name: "Your course plan" })).toBeVisible({ timeout: 600_000 });
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];
  for (const m of ["normal", "lock-in"] as const) {
    await mode(page, m);
    await page.goto(`/p/${projectId}/setup`);
    const files = page.locator(".m-files-details").first();
    await files.locator("summary").click();
    await expect(page.locator(".m-file-reason").first()).toBeVisible({ timeout: 60_000 });
    await files.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
    await shoot(page, m === "normal" ? "04-import" : "lock-in-import");
  }
  await mode(page, "normal");
  await context.close();
});

test("video: frames of scrolling the Layers tab, from the opening scene through three weeks", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, storageState: SEEN });
  const page = await context.newPage();
  await openTab(page, "layers");
  await page.waitForTimeout(2500);
  const stops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ov-scene")].slice(0, 3).map((s) => s.offsetTop + s.offsetHeight - innerHeight));
  // 8 seconds at 30 fps: a hold, a glide to each week's settled scene with a short rest on it, a hold at the end
  const FPS = 30;
  const plan: { to: number; frames: number }[] = [
    { to: 0, frames: 15 },
    { to: stops[0], frames: 66 },
    { to: stops[0], frames: 15 },
    { to: stops[1], frames: 60 },
    { to: stops[1], frames: 15 },
    { to: stops[2] ?? stops[1] + 900, frames: 60 },
  ];
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  let n = 0;
  let at = 0;
  for (const leg of plan) {
    const from = at;
    for (let i = 1; i <= leg.frames; i++) {
      const t = i / leg.frames;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in and out
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(from + (leg.to - from) * e));
      await page.waitForTimeout(60); // the compositor's scroll scenes catch up
      await page.screenshot({ path: path.join(FRAMES, `f${String(n++).padStart(4, "0")}.jpg`), type: "jpeg", quality: 95 });
    }
    at = leg.to;
  }
  expect(n / FPS).toBeGreaterThanOrEqual(6);
  await context.close();
});
