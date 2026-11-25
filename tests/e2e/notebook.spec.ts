import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { layerIdsOf, seedProject, writeUps } from "./helpers";

// Note to Self as an open book: cover, the condensed notes on the left page, the saved write-ups on the right (with a layer's older quick
// notes under its write-up), the fixed chat and highlight-to-ask. Fake engine throughout.
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
test.describe.configure({ mode: "serial" });

let id = "";
let layerIds: string[] = [];
const FIRST = "The first layer introduces the republic and its large size, and explains why faction is the danger that the whole argument returns to again and again as the course goes on.";
const SECOND = "A second layer, in my own words. It shows how one idea develops into the next.";
const OLD_NOTES = "idea → next idea";
const LAST = "The last layer closes the argument. It says why a large republic can check the factions that a small one cannot.";

test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Notebook Course");
  const page = await browser.newPage();
  layerIds = await layerIdsOf(page, id);
  await page.close();
  const send = async (layer: string, text: string, choice: "own" | "refined") => {
    const r = await request.post(`/api/layers/${layer}/submit`, { data: { text } });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await request.post(`/api/layers/${layer}/save`, { data: { writebackId: thread.latestWritebackId, choice } });
  };
  await send(layerIds[0], FIRST, "own");
  await send(layerIds[1], SECOND, "refined");
  await send(layerIds[layerIds.length - 1], `${LAST}\n\nA second paragraph for the last layer.`, "own");
  // quick notes written for the second layer before the left page became the condensed notes: they are kept
  expect((await request.put(`/api/projects/${id}/quick-notes`, { data: { targetType: "layer", targetId: layerIds[1], text: OLD_NOTES } })).ok()).toBe(true);
});

const open = async (page: Page) => {
  await page.goto(`/p/${id}/notes`);
  await expect(page.locator(".nb-book")).toBeVisible();
};

test("opens with a cover that swings away, keeps the Margin top bar with its way back, and has no layers sidebar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect(page.locator(".nb-cover")).toBeAttached();
  await expect(page.getByRole("link", { name: "Back to Notebook Course" })).toBeVisible();
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 }); // gone once it has opened
  await expect(page.getByRole("link", { name: "Back to Notebook Course" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Layers", exact: true })).toHaveCount(0);
  await expect(page.locator(".m-left")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("reduced motion: no cover at all", async ({ browser }) => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0);
  await expect(page.locator(".nb-row").first()).toBeVisible();
  await page.close();
});

test("only saved layers, in course order; the only words on the pages are my write-ups and my notes", async ({ page }) => {
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  // layers I haven't saved are hidden: three were saved, so three write-ups
  await expect(page.locator(".nb-entry")).toHaveCount(3);
  const writeups = (await writeUps(page)).map((w) => w.value);
  expect(writeups).toEqual([FIRST, SECOND, `${LAST}\n\nA second paragraph for the last layer.`]);
  // nothing Margin adds is printed: every piece of text on the book is in a write-up box, a notes box, a screen-reader line or a hover-only
  // Delete; there is no switch above the left page any more
  const stray = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".nb-book *"))
      .filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim()))
      .filter((e) => !e.closest(".sr-only") && !e.closest(".nb-text") && !e.closest(".nb-remove"))
      .map((e) => e.textContent!.trim()),
  );
  expect(stray).toEqual([]);
  await expect(page.getByRole("button", { name: "Layer notes" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Notes page" })).toHaveCount(0);
  // the left page is the condensed notes, with its quiet placeholder; the write-ups have none
  await expect(page.locator(".nb-l").getByRole("textbox", { name: "Condensed notes" })).toHaveAttribute("placeholder", "Read your notes on the right and write a shorter version here.");
  await expect(page.locator(".nb-entry > .nb-text").first()).not.toHaveAttribute("placeholder", /.+/);
  await expect(page.locator(".nb-book a")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveClass(/sr-only/); // the only heading, for screen readers
  await expect(page.locator(".nb-book h2, .nb-book h3")).toHaveCount(0);
});

test("two plain pages: rounded corners, spine shadow, plum margin lines, no ruled lines anywhere", async ({ page }) => {
  await open(page);
  const g = await page.evaluate(() => {
    const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const book = rect(".nb-book");
    const spine = rect(".nb-spine");
    const margins = Array.from(document.querySelectorAll(".nb-margin")).map((m) => ({ x: m.getBoundingClientRect().left - book.left, w: getComputedStyle(m).width, c: getComputedStyle(m).backgroundColor }));
    const images = Array.from(document.querySelectorAll(".nb-book *")).map((e) => getComputedStyle(e).backgroundImage).filter((b) => b.includes("repeating"));
    const borders = Array.from(document.querySelectorAll(".nb-row, .nb-l, .nb-r, .nb-text")).map((e) => getComputedStyle(e).borderTopWidth + getComputedStyle(e).borderBottomWidth);
    return { radius: getComputedStyle(document.querySelector(".nb-book")!).borderTopLeftRadius, bookW: book.width, spineCentre: spine.left + spine.width / 2 - (book.left + book.width / 2), margins, images, borders, ruling: document.querySelectorAll(".nb-ruling").length };
  });
  expect(parseFloat(g.radius)).toBeGreaterThanOrEqual(12);
  expect(Math.abs(g.spineCentre)).toBeLessThan(1);
  expect(g.margins).toHaveLength(2);
  expect(Math.abs(g.margins[0].x - 40)).toBeLessThan(1);
  expect(Math.abs(g.margins[1].x - (g.bookW / 2 + 40))).toBeLessThan(1);
  for (const m of g.margins) expect(m.c).toMatch(/rgba\(176, 96, 196/);
  expect(g.ruling).toBe(0);
  expect(g.images).toEqual([]); // no repeating-gradient rules
  expect(g.borders.every((b) => b === "0px0px")).toBe(true); // no divider lines
});

test("comfortable line spacing, the condensed notes start level with the first write-up, write-ups apart by space only", async ({ page }) => {
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  const m = await page.evaluate(() => {
    const entries = Array.from(document.querySelectorAll<HTMLElement>(".nb-entry"));
    const lh = (el: Element) => parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize);
    const condensed = document.querySelector(".nb-l .nb-text")!;
    const firstWrite = entries[0].querySelector(":scope > .nb-text")!;
    return {
      ratio: lh(firstWrite),
      condensedRatio: lh(condensed),
      level: Math.abs(condensed.getBoundingClientRect().top - firstWrite.getBoundingClientRect().top),
      gaps: entries.slice(1).map((e, i) => e.getBoundingClientRect().top - entries[i].getBoundingClientRect().bottom),
    };
  });
  expect(m.ratio).toBeGreaterThanOrEqual(1.55);
  expect(m.condensedRatio).toBeGreaterThanOrEqual(1.55);
  expect(m.level, "the first line of the condensed notes and of the first write-up are at the same height").toBeLessThan(2);
  for (const gap of m.gaps) expect(gap, "a little extra space between write-ups").toBeGreaterThanOrEqual(40);
});

test("a layer's older quick notes stay, under its write-up, smaller, editable: -> gives an arrow, autosaves, survives a reload", async ({ page, request }) => {
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  // only the layer that had quick notes shows them, inside its own write-up
  await expect(page.getByRole("textbox", { name: /^Quick notes for / })).toHaveCount(1);
  const second = page.locator(".nb-entry").nth(1);
  const field = second.getByRole("textbox", { name: /^Quick notes for / });
  await expect(field).toHaveValue(OLD_NOTES);
  const sizes = await second.evaluate((e) => [parseFloat(getComputedStyle(e.querySelector(":scope > .nb-text")!).fontSize), parseFloat(getComputedStyle(e.querySelector(".nb-quick .nb-text")!).fontSize)]);
  expect(sizes[1], "the notes are smaller than the write-up").toBeLessThan(sizes[0]);
  const below = await second.evaluate((e) => e.querySelector(".nb-quick")!.getBoundingClientRect().top - e.querySelector(":scope > .nb-text")!.getBoundingClientRect().bottom);
  expect(below).toBeGreaterThanOrEqual(0); // under the write-up
  await field.click();
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${id}/quick-notes`) && r.request().method() === "PUT" && r.ok(), { timeout: 20_000 });
  await field.pressSequentially(" -> faction");
  await expect(field).toHaveValue(`${OLD_NOTES} → faction`);
  await saved;
  await page.reload();
  await expect(page.locator(".nb-entry").nth(1).getByRole("textbox", { name: /^Quick notes for / })).toHaveValue(`${OLD_NOTES} → faction`);
  // not the Let's talk! notepad
  expect(((await (await request.get(`/api/projects/${id}/notepad`)).json()) as { blocks: unknown[] }).blocks).toEqual([]);
});

test("the chat stays fixed while the notebook scrolls, scrolls on its own, and collapses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 }); // short, so the book scrolls
  await open(page);
  const chat = page.getByRole("complementary", { name: "Ask about your notes" });
  const before = await chat.boundingBox();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const after = await chat.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.height).toBe(before!.height);
  await expect(chat.locator(".m-chat-list")).toHaveCSS("overflow-y", "auto");
  await chat.getByRole("button", { name: "Hide chat" }).click();
  await expect(chat.getByRole("textbox", { name: "Ask about your notes" })).toBeHidden();
  await chat.getByRole("button", { name: "Ask" }).click();
  await expect(chat.getByRole("textbox", { name: "Ask about your notes" })).toBeVisible();
});

test("highlight to ask: the chip pins the passage as the topic, the chat answers on it, a new highlight starts a new topic", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  const chat = page.getByRole("complementary", { name: "Ask about your notes" });
  const ask = page.getByRole("button", { name: "Ask about this" });
  await expect(ask).toHaveCount(0);

  await page.locator(".nb-entry").nth(0).locator(":scope > .nb-text").selectText();
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(chat.locator(".m-topic-now")).toContainText("The first layer introduces the republic");
  await chat.getByRole("textbox", { name: "Ask about your notes" }).fill("How can I write this more thoroughly?");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.getByText("Here is what your files say").first()).toBeVisible({ timeout: 15_000 });
  await expect(chat.locator(".m-msg .m-topic").first()).toContainText("The first layer introduces the republic");

  // a follow-up stays on the same passage: no second header
  await chat.getByRole("textbox", { name: "Ask about your notes" }).fill("And what is missing?");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.locator(".m-msg[data-kind='tutor']")).toHaveCount(2, { timeout: 15_000 });
  await expect(chat.locator(".m-msg .m-topic")).toHaveCount(1);

  // a passage selected in the quick notes, then typing in the chat without pressing the chip, also becomes the topic
  const field = page.getByRole("textbox", { name: "Condensed notes" });
  await field.fill("faction -> the main danger");
  await field.selectText();
  await expect(ask).toBeVisible();
  await chat.getByRole("textbox", { name: "Ask about your notes" }).fill("Is this right?");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.locator(".m-msg[data-kind='tutor']")).toHaveCount(3, { timeout: 15_000 });
  await expect(chat.locator(".m-topic-now")).toContainText("faction → the main danger");
  await expect(chat.locator(".m-msg .m-topic")).toHaveCount(2); // the earlier topic stays in the history with its passage as a header
  await expect(chat.locator(".m-msg .m-topic").first()).toContainText("The first layer introduces the republic");

  await page.reload();
  await expect(page.getByRole("complementary", { name: "Ask about your notes" }).locator(".m-msg .m-topic")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("editing the saved write-up: click in, type, -> becomes an arrow, autosaves, and the layer's own pane shows the same text", async ({ page }) => {
  await open(page);
  const box = page.locator(".nb-entry").nth(1).locator(":scope > .nb-text");
  await box.click();
  await box.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange((el as HTMLTextAreaElement).value.length, (el as HTMLTextAreaElement).value.length));
  await box.pressSequentially(" Then it leads -> on.");
  await expect(box).toHaveValue(`${SECOND} Then it leads → on.`);
  await expect(page.locator(".nb-entry").nth(1).getByText("Saved", { exact: true }).first()).toBeAttached({ timeout: 5000 });
  await page.reload();
  await expect(page.locator(".nb-entry").nth(1).locator(":scope > .nb-text")).toHaveValue(`${SECOND} Then it leads → on.`);
  // saved as "refined": the layer's write-back pane shows the edited cleaned-up version, and still says which version it is
  await page.goto(`/p/${id}/l/${layerIds[1]}`);
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  await expect(pane.getByText(`${SECOND} Then it leads → on.`)).toBeVisible({ timeout: 30_000 });
  await expect(pane.getByText(/Sent as refined version/)).toBeVisible();
});

test("an own-writing write-up edited in the notebook is what the layer's pane shows as the submitted text", async ({ page }) => {
  await open(page);
  const box = page.locator(".nb-entry").nth(0).locator(":scope > .nb-text");
  await box.fill(`${FIRST} Edited.`);
  await expect(page.locator(".nb-entry").nth(0).getByText("Saved", { exact: true }).first()).toBeAttached({ timeout: 5000 });
  await page.goto(`/p/${id}/l/${layerIds[0]}`);
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  await expect(pane.getByText(`${FIRST} Edited.`)).toBeVisible({ timeout: 30_000 });
});

test("the notes are just text on the paper: no box, border, outline or background, even when focused", async ({ page }) => {
  await open(page);
  for (const side of [".nb-l", ".nb-r"]) {
    const field = page.locator(`${side} .nb-text`).first();
    await field.focus();
    const css = await field.evaluate((el) => {
      const c = getComputedStyle(el);
      return { border: c.borderTopWidth + c.borderRightWidth + c.borderBottomWidth + c.borderLeftWidth, outline: c.outlineStyle, shadow: c.boxShadow, bg: c.backgroundColor, resize: c.resize, appearance: c.appearance, gramm: el.getAttribute("data-gramm") };
    });
    expect(css, side).toMatchObject({ border: "0px0px0px0px", outline: "none", shadow: "none", bg: "rgba(0, 0, 0, 0)", resize: "none", gramm: "false" });
  }
});

test("the notebook chat is its own conversation: its own header and labels, no link to Let's talk!, separate history", async ({ page }) => {
  await open(page);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  const chat = page.getByRole("complementary", { name: "Ask about your notes" });
  await expect(chat.getByRole("heading", { name: "Ask about your notes" })).toBeVisible();
  await expect(chat.getByRole("heading", { name: /Let.s talk!/ })).toHaveCount(0);
  await expect(chat.getByRole("link", { name: /Open Chat, Sources and Notepad/ })).toHaveCount(0);
  await expect(chat.getByText("Your professor")).toHaveCount(0);
  const before = await page.request.get(`/api/projects/${id}/talk`).then((r) => r.json() as Promise<{ messages: { content: string }[] }>);
  await chat.getByRole("textbox", { name: "Ask about your notes" }).fill("What is a faction? asked in my notebook");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.getByText("Notes guide").first()).toBeVisible({ timeout: 15_000 });
  await expect(chat.getByText("Here is what your files say").first()).toBeVisible();
  // Let's talk! has not heard of it, and the section's chat does not show it
  const after = await page.request.get(`/api/projects/${id}/talk`).then((r) => r.json() as Promise<{ messages: { content: string }[] }>);
  expect(after.messages).toEqual(before.messages);
  const note = await page.request.get(`/api/projects/${id}/talk?channel=note`).then((r) => r.json() as Promise<{ messages: { content: string }[] }>);
  expect(note.messages.some((m) => m.content.includes("asked in my notebook"))).toBe(true);
  await page.goto(`/p/${id}/talk`);
  const talk = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(talk.getByRole("textbox", { name: "Ask your professor" })).toBeVisible();
  await expect(talk.getByText("asked in my notebook")).toHaveCount(0);
});

test("chat replies render markdown, in the notebook chat and in Let's talk!: bold, bullets and line breaks, no stars", async ({ page }) => {
  const reply = "**Faction** is the danger.\nSecond line [POL101 Syllabus F26.md, p. 1]\n\n- one point\n- *another* point";
  const stub = (channel: string) => page.route(`**/api/projects/*/talk?channel=${channel}`, (route) => route.fulfill({ json: { messages: [{ id: "m1", role: "assistant", content: reply, context: null, topic: null, createdAt: 1 }] } }));
  await stub("note");
  await open(page);
  const chat = page.getByRole("complementary", { name: "Ask about your notes" });
  await expect(chat.locator(".m-md strong").first()).toHaveText("Faction");
  await expect(chat.locator(".m-md li")).toHaveText(["one point", "another point"]);
  await expect(chat.locator(".m-md br")).toHaveCount(1);
  await expect(chat.locator(".m-md .m-cite-inline")).toHaveCount(1);
  expect(await chat.locator(".m-md").innerText()).not.toContain("*");
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 5000 });
  await expect(chat.locator(".m-md li").first()).toHaveCSS("list-style-type", "disc");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v3-notebook-markdown-1440.png") });
  await stub("talk");
  await page.goto(`/p/${id}/talk`);
  const talk = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(talk.locator(".m-md strong").first()).toHaveText("Faction");
  await expect(talk.locator(".m-md li")).toHaveCount(2);
  await expect(talk.locator(".m-md li").first()).toHaveCSS("list-style-type", "disc");
  expect(await talk.locator(".m-md").innerText()).not.toContain("*");
});

test("on a phone-width screen the book is one page at a time, the chat starts closed, and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.getByRole("textbox", { name: "Ask about your notes" })).toBeHidden();
  await page.getByRole("button", { name: "Ask", exact: true }).click({ timeout: 5000 });
  await expect(page.getByRole("textbox", { name: "Ask about your notes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("photographs at a laptop size (1440x900 and 1280x800) and 1024, and nothing scrolls sideways", async ({ page }) => {
  test.skip(!SHOTS, "photographs only with SHOTS=1");
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/p/${id}/notes`);
    await page.waitForTimeout(450);
    if (w === 1440) await page.screenshot({ path: path.join(SHOTS!, `v3-notebook-cover-${w}.png`) });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS!, `v3-notebook-${w}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.locator(".nb-entry").nth(1).hover();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS!, `v3-notebook-delete-hover-${w}.png`) });
    await page.locator(".nb-entry").nth(0).locator(":scope > .nb-text").selectText();
    await expect(page.getByRole("button", { name: "Ask about this" })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS!, `v3-notebook-ask-chip-${w}.png`) });
    await page.getByRole("button", { name: "Ask about this" }).click();
    await page.getByRole("textbox", { name: "Ask about your notes" }).fill("How can I write this more thoroughly?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Here is what your files say").last()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOTS!, `v3-notebook-chat-${w}.png`) });
  }
});
