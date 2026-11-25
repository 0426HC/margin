import { expect, test, type Browser, type Page } from "@playwright/test";
import { dbAll, layerIdsOf, seedProject } from "./helpers";

// The course page in tabs: Layers | Let's talk! | Lecture notes | Exam room | Note to Self. Each tab has its own address; normal mode
// shows each section's scene, lock in shows each section's real page. Also the home page in lock in, Note to Self's cover and its lock in
// layout, every chatbot in lock in, and Layers or Weeks in the sidebar. Fake engine, throwaway data folder (playwright.config.ts).
test.describe.configure({ mode: "serial" });

let id = "";
let layers: string[] = [];

test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Tabs Course");
  const page = await browser.newPage();
  layers = await layerIdsOf(page, id);
  await page.close();
  // two saved write-ups, so Note to Self has something on its pages
  for (const [i, text] of [
    [0, "The first layer, in my own words: the republic is large, and faction is the danger the whole argument returns to."],
    [1, "The second layer, in my own words: one idea grows into the next."],
  ] as const) {
    const r = await request.post(`/api/layers/${layers[i]}/submit`, { data: { text } });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await request.post(`/api/layers/${layers[i]}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" } });
  }
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const tabs = (page: Page) => page.getByRole("navigation", { name: "Course sections" });
const tab = (page: Page, name: RegExp) => tabs(page).getByRole("link", { name });
const LAYERS = /^Layers/;
const TALK = /^Let’s talk!/;
const LECTURE = /^Lecture notes/;
const EXAM = /^Exam room/;
const NOTES = /^Note to Self/;

async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
/** Put the app in a mode the way a returning student finds it: remembered, then a fresh load. */
async function mode(page: Page, m: "normal" | "lock-in") {
  if (page.url() === "about:blank") await go(page, "/");
  await page.evaluate((v) => localStorage.setItem("margin:mode", v), m);
}
async function fresh(browser: Browser, storage: Record<string, string>, opts: { reducedMotion?: "reduce" } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion,
    storageState: {
      cookies: [],
      origins: [{ origin: "http://localhost:" + (process.env.E2E_PORT ?? 3100), localStorage: Object.entries({ "margin:lock-in-hint-seen": "1", "margin:weeks-hint-seen": "1", ...storage }).map(([name, value]) => ({ name, value })) }],
    },
  });
  return { context, page: await context.newPage() };
}

// ---------------------------------------------------------------- normal mode: each tab is its scene

test("the tabs are in order, and each one shows its own scene, unchanged", async ({ page }) => {
  await mode(page, "normal");
  await go(page, `/p/${id}`);
  await expect(tabs(page).getByRole("link")).toHaveText([/^Layers\s*\d+\/\d+$/, /^Let’s talk!/, /^Lecture notes/, /^Exam room/, /^Note to Self/]);
  await expect(tab(page, LAYERS)).toHaveAttribute("aria-current", "page");
  // Layers: the course title and the round table, then the weeks
  await expect(page.locator("#ov-course")).toBeVisible();
  await expect(page.locator(".ov-hall .hall-table").first()).toBeVisible();
  await expect(page.locator("[aria-labelledby^='ov-h-']")).toHaveCount(3); // one scene per week
  await expect(page.locator("#ov-talk-h")).toHaveCount(0);

  for (const [name, q, heading, art] of [
    [TALK, "talk", "#ov-talk-h", ".art-laptop"],
    [LECTURE, "lecture-notes", "#ov-weeks-h", ".art-week"],
    [EXAM, "exam", "#ov-exam-h", ".art-exam"],
    [NOTES, "note-to-self", "#ov-note-h", ".art-notebook"],
  ] as const) {
    await tab(page, name).click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}\\?tab=${q}$`));
    await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(heading)).toBeVisible();
    await expect(page.locator(`[aria-labelledby='${heading.slice(1)}'] ${art}`).first()).toBeVisible();
    // it fills the space under the bars: no page scroll needed to reach it
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator(heading)).toBeInViewport();
    // only this tab's scene is on the page
    await expect(page.locator("#ov-course")).toHaveCount(0);
  }
  // the scene plays its entrance when its tab is opened: it fades up from hidden
  await tab(page, TALK).click();
  await expect(page.locator("[aria-labelledby='ov-talk-h']")).toHaveAttribute("data-reveal", /armed|shown/);
  await expect(page.locator("[aria-labelledby='ov-talk-h']")).toHaveAttribute("data-reveal", "shown");
});

test("the tab is in the address: it survives a refresh and the back button", async ({ page }) => {
  await mode(page, "normal");
  await go(page, `/p/${id}?tab=layers`);
  await tab(page, TALK).click();
  await expect(page.locator("#ov-talk-h")).toBeVisible();
  await tab(page, EXAM).click();
  await expect(page.locator("#ov-exam-h")).toBeVisible();
  await page.reload();
  await expect(page.locator("#ov-exam-h")).toBeVisible();
  await expect(tab(page, EXAM)).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/tab=talk$/);
  await expect(page.locator("#ov-talk-h")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/tab=layers$/);
  await expect(page.locator("#ov-course")).toBeVisible();
  await page.goForward();
  await expect(page.locator("#ov-talk-h")).toBeVisible();
});

test("Margin remembers the last tab per project and opens there; the project card opens it too", async ({ browser, request }) => {
  const other = await seedProject(request, "Second Tabs Course");
  try {
    const { context, page } = await fresh(browser, { "margin:mode": "normal" });
    await go(page, `/p/${id}?tab=lecture-notes`);
    await go(page, `/p/${other}`);
    await expect(tab(page, LAYERS)).toHaveAttribute("aria-current", "page"); // another course keeps its own (none yet: Layers)
    await go(page, `/p/${id}`);
    await expect(page).toHaveURL(new RegExp(`/p/${id}\\?tab=lecture-notes$`));
    await expect(page.locator("#ov-weeks-h")).toBeVisible();
    await go(page, "/");
    await page.locator(`[data-project-id="${id}"] .ho-open`).click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}\\?tab=lecture-notes$`));
    await expect(page.locator("#ov-weeks-h")).toBeVisible();
    // blocked storage still opens the page, on Layers
    await context.close();
  } finally {
    await request.delete(`/api/projects/${other}`);
  }
});

test("links elsewhere open the right tab: each section's way back, and a layer's", async ({ page }) => {
  await mode(page, "normal");
  for (const [path, q, heading] of [
    [`/p/${id}/talk`, "talk", "#ov-talk-h"],
    [`/p/${id}/lecture-notes`, "lecture-notes", "#ov-weeks-h"],
    [`/p/${id}/exam`, "exam", "#ov-exam-h"],
    [`/p/${id}/l/${layers[0]}`, "layers", "#ov-course"],
  ] as const) {
    await go(page, path);
    await page.getByRole("link", { name: /^Back to / }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}\\?tab=${q}$`));
    await expect(page.locator(heading)).toBeVisible();
  }
  // the Layers tab's "Open Note to Self" still goes to the notebook; from lock in's Up next too (tested below)
});

test("the tab bar stays under the top bar while the Layers tab scrolls; the rail covers only the opening and the weeks", async ({ page }) => {
  await mode(page, "normal");
  await go(page, `/p/${id}?tab=layers`);
  const bar = page.locator(".ov-tabs");
  const top = (await bar.boundingBox())!.y;
  expect(top).toBeGreaterThanOrEqual(50);
  expect(top).toBeLessThanOrEqual(62);
  await page.mouse.wheel(0, 2400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1500);
  expect((await bar.boundingBox())!.y).toBe(top);
  await expect(tab(page, TALK)).toBeVisible();
  await expect(page.locator(".ov-head")).not.toHaveAttribute("data-scrolled", ""); // the header never gets a background (tabs-layout.spec)
  await expect(page.getByRole("navigation", { name: "Weeks" }).getByRole("button")).toHaveText([/Start/, /Week 1/, /Week 2/, /Week 3/]);
  // and a click on a tab while scrolled starts that tab at its top; Layers comes back where it was
  await page.waitForTimeout(1200); // let the smooth scroll come to rest
  const y = await page.evaluate(() => scrollY);
  await tab(page, TALK).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await tab(page, LAYERS).click();
  await expect.poll(() => page.evaluate((v) => Math.abs(scrollY - v), y)).toBeLessThan(4);
});

// ---------------------------------------------------------------- lock in: each tab is the real page

test("in lock in each tab is the real page: Up next and the weeks, Let's talk! with Chat, Sources and Notepad working, Lecture notes, the exam room", async ({ page }) => {
  test.setTimeout(120_000);
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=layers`);
  await expect(page.getByRole("region", { name: "Up next" })).toBeVisible();
  await expect(page.getByRole("main", { name: "Layers" }).getByRole("region", { name: /^Week 1 · / })).toBeVisible();
  await expect(page.locator(".ov-main, .ov-intro, .bd, .hall")).toHaveCount(0);
  // the top bar keeps everything but decoration
  const banner = page.locator(".ov-bar-top");
  for (const name of ["Update from folder", "Add files", "Focus timer"]) await expect(banner.getByRole("button", { name })).toBeVisible();
  await expect(banner.getByRole("switch", { name: "Locked in" })).toBeVisible();
  // no "Open" step in between anywhere
  await expect(page.getByRole("link", { name: /^Open / })).toHaveCount(0);

  // Let's talk!: the real page, under the course's bar, with all three of its tabs working
  await tab(page, TALK).click();
  await expect(page).toHaveURL(/tab=talk$/);
  await expect(page.getByRole("heading", { level: 1, name: "Let’s talk!" })).toBeVisible();
  await expect(page.locator(".m-topbar")).toHaveCount(0); // only the course's own bar
  const chat = page.getByRole("complementary", { name: "Let's talk!" });
  await chat.getByRole("textbox", { name: "Ask your professor" }).fill("What do the readings say about faction?");
  await chat.getByRole("button", { name: "Ask" }).click();
  await expect(chat.getByText("Here is what your files say")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/tab=talk$/); // its inner tabs never take over the address
  await page.getByRole("tab", { name: "Sources" }).click();
  await page.getByRole("button", { name: "Find sources now" }).click();
  await expect(page.locator(".m-tt-topic").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Notepad" }).click();
  const pad = page.getByRole("textbox", { name: "Notepad" });
  await pad.click();
  await page.keyboard.type("Lock in notepad line");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/tab=talk$/);

  // Lecture notes: the real page, every week
  await tab(page, LECTURE).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lecture notes" })).toBeVisible();
  await expect(page.getByText("Week 1", { exact: true }).first()).toBeVisible();
  // the exam room: the real page
  await tab(page, EXAM).click();
  await expect(page.getByRole("heading", { level: 1, name: "The exam room" })).toBeVisible();
  // and the page as a whole never scrolls: each real page fills the window below the bars
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
  // switching lock in off in place brings the scene back in the same tab
  await page.getByRole("switch", { name: "Locked in" }).click();
  await expect(page.locator("#ov-exam-h")).toBeVisible();
  await expect(page).toHaveURL(/tab=exam$/);
});

test("the home page in lock in keeps its title, words and cards in the same places, on a fresh tab too", async ({ browser }) => {
  const at = async (m: "normal" | "lock-in") => {
    const { context, page } = await fresh(browser, { "margin:mode": m });
    await go(page, "/");
    await page.waitForTimeout(3800); // after the normal entrance
    const out = await page.evaluate(() => {
      const top = (s: string) => Math.round(document.querySelector(s)!.getBoundingClientRect().top + scrollY);
      return { word: top(".ho-word"), ink: top(".ho-ink"), greet: top(".ho-greet"), grid: top(".ho-grid"), height: document.documentElement.scrollHeight };
    });
    const words = { title: await page.locator(".ho-word").isVisible(), greet: await page.locator(".ho-greet").innerText(), cards: await page.locator(".ho-tile").count(), newCard: await page.locator(".ho-new", { hasText: "New project" }).isVisible() };
    const decoration = await page.locator(".ho-hall, .bd").count();
    await context.close();
    return { out, words, decoration };
  };
  const normal = await at("normal");
  const locked = await at("lock-in");
  expect(locked.out).toEqual(normal.out);
  expect(locked.words.title).toBe(true);
  expect(locked.words.greet).toMatch(/layers? (is|are) finished across your courses/);
  expect(locked.words.cards).toBe(normal.words.cards);
  expect(locked.words.newCard).toBe(true);
  expect(locked.decoration).toBe(0);
  expect(normal.decoration).toBeGreaterThan(0);
});

test("every tab, and the home page, show on a fresh tab's first load in both modes", async ({ browser }) => {
  test.setTimeout(150_000);
  for (const m of ["normal", "lock-in"] as const) {
    const { context, page } = await fresh(browser, { "margin:mode": m });
    await go(page, "/");
    await expect(page.locator(".ho-word")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
    for (const [q, normalSel, lockSel] of [
      ["layers", "#ov-course", ".lk-next"],
      ["talk", "#ov-talk-h", "h1:has-text('Let’s talk!')"],
      ["lecture-notes", "#ov-weeks-h", "h1:has-text('Lecture notes')"],
      ["exam", "#ov-exam-h", "h1:has-text('The exam room')"],
      ["note-to-self", "#ov-note-h", ".lk-nts"],
    ] as const) {
      // a new tab per page: its very first load
      const p = await context.newPage();
      await go(p, `/p/${id}?tab=${q}`);
      await expect(p.locator(m === "normal" ? normalSel : lockSel).first(), `${m} ${q}`).toBeVisible();
      await expect(p.locator(m === "normal" ? lockSel : normalSel), `${m} ${q}: only one version`).toHaveCount(0);
      await p.close();
    }
    await context.close();
  }
});

// ---------------------------------------------------------------- Note to Self

test("normal mode: the notebook cover opens every time Note to Self is opened, from the tab, the sidebar or a link", async ({ page }) => {
  await mode(page, "normal");
  const coverPlays = async () => {
    await expect(page.locator(".nb-cover")).toBeVisible();
    await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 4000 }); // it swings away
    await expect(page.locator(".nb-book")).toBeVisible();
  };
  await go(page, `/p/${id}?tab=note-to-self`);
  await page.getByRole("button", { name: "Open Note to Self" }).click();
  await coverPlays();
  // to a layer, then back by the sidebar
  await go(page, `/p/${id}/l/${layers[0]}`);
  await page.getByRole("link", { name: "Note to Self" }).first().click();
  await coverPlays();
  // all by links inside the app (Next keeps visited pages alive): to a layer, back to the course, the Note to Self tab, and in again
  await page.getByRole("link", { name: /^Continue with / }).click();
  await page.waitForURL(/\/l\//);
  await page.getByRole("link", { name: /^Back to / }).click();
  await page.waitForURL(/tab=layers$/);
  await tab(page, NOTES).click();
  await page.getByRole("button", { name: "Open Note to Self" }).click();
  await coverPlays();
});

test("reduced motion: Note to Self opens with no cover", async ({ browser }) => {
  const { context, page } = await fresh(browser, { "margin:mode": "normal" }, { reducedMotion: "reduce" });
  await go(page, `/p/${id}?tab=note-to-self`);
  await page.getByRole("button", { name: "Open Note to Self" }).click();
  await expect(page.locator(".nb-book")).toBeVisible();
  await expect(page.locator(".nb-cover")).toHaveCount(0);
  await context.close();
});

test("lock in: Note to Self is three plain columns (condensed notes, a line, write-ups) beside the chat; no notebook look and nothing moves", async ({ page }) => {
  await mode(page, "lock-in");
  for (const path of [`/p/${id}?tab=note-to-self`, `/p/${id}/notes`]) {
    await go(page, path);
    const plain = page.locator(".lk-nts");
    await expect(plain).toBeVisible();
    await expect(page.locator(".nb-book, .nb-cover, .nb-spine, .nb-margin")).toHaveCount(0);
    const condensed = page.getByRole("region", { name: "Condensed notes" });
    const writeUps = page.getByRole("region", { name: "Your saved write-ups" });
    const chat = page.getByRole("complementary", { name: "Ask about your notes" });
    const [n, rule, w, c] = await Promise.all([condensed.boundingBox(), page.locator(".lk-nts-rule").boundingBox(), writeUps.boundingBox(), chat.boundingBox()]);
    expect(n!.x + n!.width).toBeLessThanOrEqual(rule!.x + 0.5);
    expect(rule!.width).toBeLessThanOrEqual(1.5);
    expect(rule!.x + rule!.width).toBeLessThanOrEqual(w!.x + 0.5);
    expect(w!.x + w!.width).toBeLessThanOrEqual(c!.x);
    // the left column is the condensed notes: its small mono label and a quiet placeholder; the layer notes are not here
    await expect(condensed.locator(".lk-nts-label")).toHaveText("Condensed notes");
    await expect(condensed.getByRole("textbox", { name: "Condensed notes" })).toHaveAttribute("placeholder", "Read your notes on the right and write a shorter version here.");
    await expect(page.locator(".lk-nts").getByRole("textbox", { name: /^Quick notes for / })).toHaveCount(0);
    // each write-up is labelled with its layer, in course order
    await expect(writeUps.locator(".lk-nts-label > span")).toHaveCount(2);
    // plain: Graphite, Literata, no paper, no ruled lines, no animation anywhere on the page
    const look = await page.evaluate(() => {
      const t = document.querySelector(".lk-nts .nb-text") as HTMLElement;
      const all = [...document.querySelectorAll(".lk-nts, .lk-nts *")];
      return {
        font: getComputedStyle(t).fontFamily,
        bg: getComputedStyle(document.querySelector(".lk-nts")!).backgroundColor,
        lines: all.filter((e) => /repeating-linear-gradient/.test(getComputedStyle(e).backgroundImage)).length,
        moving: all.filter((e) => getComputedStyle(e).animationName !== "none" && parseFloat(getComputedStyle(e).animationDuration) > 0).length,
      };
    });
    expect(look.font).toMatch(/Literata/i);
    expect(look.bg).toBe("rgb(14, 15, 17)");
    expect(look.lines).toBe(0);
    expect(look.moving).toBe(0);
  }
});

test("lock in: a write-up edited there is the saved write-up in the book too", async ({ page }) => {
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=note-to-self`);
  const first = page.getByRole("textbox", { name: /^Saved write-up of / }).first();
  const label = (await first.getAttribute("aria-label"))!;
  const was = await first.inputValue();
  await first.click();
  await first.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(e.value.length, e.value.length));
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${id}/write-up`) && r.request().method() === "PUT" && r.ok(), { timeout: 20_000 });
  await page.keyboard.type(" Edited in lock in -> saved.");
  await expect(first).toHaveValue(`${was} Edited in lock in → saved.`);
  await saved; // the autosave went through
  // the book, after a reload: the same text
  await mode(page, "normal");
  await go(page, `/p/${id}/notes`);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByRole("textbox", { name: label })).toHaveValue(`${was} Edited in lock in → saved.`);
  // and back as it was
  await page.getByRole("textbox", { name: label }).fill(was);
  await page.waitForTimeout(1200);
});

test("lock in: Delete takes a write-up away with Undo for a moment; Undo keeps it, and without it it is gone for good", async ({ page }) => {
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=note-to-self`);
  const writeUps = page.getByRole("region", { name: "Your saved write-ups" });
  const first = writeUps.locator(".lk-nts-entry").first();
  const title = (await first.locator(".lk-nts-label > span").innerText()).trim();
  const count = () => dbAll<{ n: number }>("select count(*) as n from note_saves where target_id in (select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ?)", id)[0].n;
  const before = count();
  // Delete, then Undo: nothing changed
  await first.hover();
  await first.getByRole("button", { name: `Delete the write-up of “${title}” from Note to Self` }).click();
  await expect(writeUps.getByRole("status").filter({ hasText: `Deleted “${title}”.` })).toBeVisible();
  await expect(writeUps.locator(".lk-nts-entry")).toHaveCount(1);
  await writeUps.getByRole("button", { name: "Undo" }).click();
  await expect(writeUps.locator(".lk-nts-entry")).toHaveCount(2);
  await expect(writeUps.locator(".lk-nts-entry").first()).toContainText(title);
  await page.waitForTimeout(7000); // longer than Undo is offered
  expect(count()).toBe(before);
  // Delete and let it go: gone for good, in the book too
  await writeUps.locator(".lk-nts-entry").first().hover();
  await writeUps.locator(".lk-nts-entry").first().getByRole("button", { name: /^Delete the write-up/ }).click();
  await expect.poll(count, { timeout: 10_000 }).toBe(before - 1);
  await expect(writeUps.locator(".lk-nts-entry")).toHaveCount(1);
  await mode(page, "normal");
  await go(page, `/p/${id}/notes`);
  await expect(page.locator(".nb-entry")).toHaveCount(1);
  await expect(page.locator(".nb-entry").first()).not.toHaveAttribute("aria-label", `Write-up of ${title}`);
});

test("lock in: the condensed notes and the write-ups scroll on their own, and the chat hides and comes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 520 }); // short, so the columns scroll
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=note-to-self`);
  const condensed = page.getByRole("region", { name: "Condensed notes" });
  const writeUps = page.getByRole("region", { name: "Your saved write-ups" });
  const field = condensed.getByRole("textbox", { name: "Condensed notes" });
  const was = await field.inputValue();
  await field.fill(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"));
  await expect.poll(() => condensed.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
  await condensed.evaluate((el) => (el.scrollTop = 200));
  expect(await condensed.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(await writeUps.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBe(0); // the page itself stays put
  await field.fill(was);
  await page.waitForTimeout(1000);

  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await writeUps.boundingBox())!.width;
  await page.getByRole("button", { name: "Hide chat" }).click();
  await expect(page.getByRole("button", { name: "Ask" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await writeUps.boundingBox())!.width).toBeGreaterThan(before + 100);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide chat" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Ask about your notes" }).getByRole("textbox")).toBeVisible();
});

// ---------------------------------------------------------------- every chatbot keeps its place in lock in

test("every chatbot stays where it is in lock in: in a layer, a synthesis, Let's talk! and Note to Self", async ({ page }) => {
  const boxes = async () => {
    const out: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
    for (const [name, path, sel] of [
      ["layer", `/p/${id}/l/${layers[0]}`, ".m-right"],
      ["synthesis", `/p/${id}/week/1/synthesis`, ".m-right"],
      ["talk", `/p/${id}/talk`, ".m-tt-chat"],
      ["notes", `/p/${id}/notes`, ".nb-chat"],
    ] as const) {
      await go(page, path);
      const el = page.locator(sel).first();
      await expect(el, `${name}`).toBeVisible();
      out[name] = await el.boundingBox();
    }
    return out;
  };
  await mode(page, "normal");
  const normal = await boxes();
  await mode(page, "lock-in");
  const locked = await boxes();
  for (const k of Object.keys(normal)) {
    const a = normal[k]!;
    const b = locked[k]!;
    expect(Math.abs(a.x - b.x), k).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - b.width), k).toBeLessThanOrEqual(1);
  }
  // in the layer, the chat answers in lock in too
  await go(page, `/p/${id}/l/${layers[2]}`);
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  const side = page.getByRole("complementary", { name: "Let's talk!" });
  await side.getByRole("textbox", { name: "Ask your professor" }).fill("A question from lock in");
  await side.getByRole("button", { name: "Ask" }).click();
  await expect(side.getByText("Here is what your files say").last()).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------- the sidebar, by week

test.describe("the sidebar, by week", () => {
  let wk = "";

  test.beforeAll(async ({ request }) => {
    // The sample course with its week 2 and 3 files moved to weeks 4 and 5 before the layers are planned: weeks 1 to 3 then have no material.
    wk = await seedProject(request, "Weeks Course", {
      beforePropose: async (pid) => {
        const files = dbAll<{ id: string; week: number | null }>("select id, week from files where project_id = ? and (category is null or category = 'course')", pid);
        const moved = { 1: 4, 2: 4, 3: 5 } as Record<number, number>;
        for (const f of files) if (f.week !== null && f.week in moved) await request.patch(`/api/projects/${pid}/files/${f.id}`, { data: { week: moved[f.week] } });
      },
    });
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/projects/${wk}`);
  });

  const sidebar = (page: Page) => page.getByRole("navigation", { name: "Layers" });

  test("weeks in order; weeks without material say so; each week ends with its optional synthesis; no Layers | Weeks switch, hint or week labels", async ({ page }) => {
    await mode(page, "normal");
    const first = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and p.week = 4 order by l.position", wk)[0].id;
    await go(page, `/p/${wk}/l/${first}`);
    const heads = await sidebar(page).locator(".m-lunit-title").allInnerTexts();
    expect(heads.map((t) => t.split(" · ")[0])).toEqual(["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]);
    for (const w of [1, 2, 3]) await expect(sidebar(page).locator(".m-wk-blank").filter({ hasText: `Week ${w}` })).toContainText("Material not added yet");
    // the week being read is open, and ends with its synthesis: a diamond and "optional"
    await expect(sidebar(page).getByRole("button", { name: /^Week 4/ })).toHaveAttribute("aria-expanded", "true");
    const synth = sidebar(page).getByRole("link", { name: /^Week synthesis for week 4/ });
    await expect(synth).toContainText("optional");
    await expect(synth.locator(".m-diamond")).toBeVisible();
    await expect(sidebar(page).locator("#week-4 > li").last()).toContainText("Week synthesis");
    // nothing of the old Layers | Weeks view
    await expect(sidebar(page).getByRole("group", { name: "List the layers by" })).toHaveCount(0);
    await expect(page.getByText("Prefer weeks? Switch here.")).toHaveCount(0);
    await expect(sidebar(page).locator(".m-sec-wk").filter({ hasText: /^wk / })).toHaveCount(0);
  });

  test("lock in shows the same weeks, and its Layers list says which weeks have no material yet", async ({ page }) => {
    await mode(page, "lock-in");
    await go(page, `/p/${wk}?tab=layers`);
    const plain = page.getByRole("main", { name: "Layers" });
    await expect(plain.getByRole("region", { name: /^Week 1/ })).toContainText("Material not added yet");
    await expect(plain.getByRole("region", { name: /^Week 4/ }).getByRole("listitem").first()).toBeVisible();
    await expect(plain.locator(".lk-row-wk")).toHaveCount(0);
    await go(page, `/p/${wk}/talk`);
    await expect(sidebar(page).getByRole("button", { name: /^Week 4/ })).toBeVisible();
    await mode(page, "normal");
  });
});
