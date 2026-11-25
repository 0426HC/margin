import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { seedProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve(undefined));

test.describe.configure({ mode: "serial" });

let id = "";
test.beforeAll(async ({ request }) => {
  id = await seedProject(request, "Talk Section Course");
});

test("the project overview has a Let's talk! tab, between Layers and Lecture notes", async ({ page }) => {
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  const tabs = page.getByRole("navigation", { name: "Course sections" });
  await expect(tabs.getByRole("link")).toHaveText([/^Layers/, /^Let’s talk!/, /^Lecture notes/, /^Exam room/, /^Note to Self/]);
  await tabs.getByRole("link", { name: /^Let’s talk!/ }).click();
  const scene = page.getByRole("region", { name: "Let’s talk!" });
  await page.waitForTimeout(1600);
  await expect(scene.getByRole("heading", { name: "Let’s talk!" })).toBeVisible();
  await expect(scene.getByRole("img", { name: /laptop open on Let’s talk!/ })).toBeVisible(); // Chat, Sources and Notepad, drawn on the laptop's screen
  await shot(page, "v2-overview-talk-1440.png");
  await scene.getByRole("link", { name: "Open Let’s talk!" }).click();
  await page.waitForURL(/\/p\/[^/]+\/talk$/);
  await expect(page.getByRole("heading", { level: 1, name: "Let’s talk!" })).toBeVisible();
});

test("Chat: one conversation, the same inside a layer, and a message sent from a layer names it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/p/${id}/talk`);
  await page.waitForLoadState("networkidle");
  const chat = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(page.getByRole("tab", { name: "Chat", selected: true })).toBeVisible();
  await chat.getByRole("textbox", { name: "Ask your professor" }).fill("What do the readings say about faction?");
  await chat.getByRole("button", { name: "Ask" }).click();
  await expect(chat.getByText("Here is what your files say")).toBeVisible({ timeout: 15_000 });
  await shot(page, "v2-talk-chat-1440.png");
  // no subtitle on a message sent from the section itself
  await expect(chat.locator(".m-msg-context")).toHaveCount(0);

  // inside a layer the same conversation continues, and the new message says where it came from
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const layerTitle = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  await page.getByRole("tab", { name: "Let’s talk!" }).click();
  const side = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(side.getByText("What do the readings say about faction?")).toBeVisible();
  await side.getByRole("textbox", { name: "Ask your professor" }).fill("And how does this layer connect?");
  await side.getByRole("button", { name: "Ask" }).click();
  await expect(side.locator(".m-msg-context")).toHaveText(`From Week 1, layer 1: ${layerTitle}`, { timeout: 15_000 });
  await shot(page, "v2-layer-talk-context-1440.png");
  await expect(side.getByText("From Week 1, layer 1")).toHaveCount(1);

  // back in the section the same two questions are there, the second with its subtitle
  await side.getByRole("link", { name: "Open Chat, Sources and Notepad" }).click();
  await page.waitForURL(/\/talk$/);
  const again = page.getByRole("complementary", { name: "Let's talk!" });
  await expect(again.getByText("And how does this layer connect?")).toBeVisible();
  await expect(again.locator(".m-msg-context")).toHaveText(`From Week 1, layer 1: ${layerTitle}`);
  expect(errors).toEqual([]);
});

test("Sources: find them now, grouped by topic and verbatim; a second run adds no duplicate", async ({ page }) => {
  // leaving the layer above already made the Librarian read the first two questions; ask something new and stay in the section
  await page.goto(`/p/${id}/talk`);
  await page.waitForLoadState("networkidle");
  const chat = page.getByRole("complementary", { name: "Let's talk!" });
  await chat.getByRole("textbox", { name: "Ask your professor" }).fill("Explain the separation of powers and checks and balances.");
  await chat.getByRole("button", { name: "Ask" }).click();
  await expect(chat.getByText("Here is what your files say")).toHaveCount(3, { timeout: 15_000 });
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByText("There is conversation the Librarian hasn’t read yet.")).toBeVisible();
  await page.getByRole("button", { name: "Find sources now" }).click();
  const topics = page.locator(".m-tt-topic");
  await expect(topics.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: /Collected \d+ new sources?|Nothing new to collect/ })).toBeVisible();
  const first = await page.locator(".m-tt-topic .m-q > p").allInnerTexts();
  expect(first.length).toBeGreaterThan(0);
  // each source names its file and page in the margin
  await expect(page.locator(".m-tt-topic .m-page-marker").first()).toContainText(/p\. \d+/);
  await expect(page.locator(".m-tt-topic .m-page-file").first()).toContainText(/\.\w+$/);
  await shot(page, "v2-talk-sources-1440.png");

  // the original page opens from a source
  await page.getByRole("button", { name: /^Show the original page/ }).first().click();
  await expect(page.getByRole("dialog").locator("mark").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Find sources now" }).click();
  await expect(page.getByText("Nothing new has been said since the Librarian last looked.")).toBeVisible({ timeout: 15_000 });
  expect(await page.locator(".m-tt-topic .m-q > p").allInnerTexts()).toEqual(first);
});

test("Sources are collected when I leave Let's talk!, and the result waits in 'While you were away'", async ({ page }) => {
  await page.goto(`/p/${id}/talk`);
  await page.waitForLoadState("networkidle");
  const chat = page.getByRole("complementary", { name: "Let's talk!" });
  const replies = chat.locator('.m-msg[data-kind="tutor"]');
  await expect(chat.getByText("Explain the separation of powers")).toBeVisible();
  const had0 = await replies.count();
  await chat.getByRole("textbox", { name: "Ask your professor" }).fill("Tell me about the executive and the judiciary.");
  await chat.getByRole("button", { name: "Ask" }).click();
  await expect(replies).toHaveCount(had0 + 1, { timeout: 15_000 });
  const before = (await (await page.request.get(`/api/projects/${id}/sources`)).json()) as { groups: { sources: unknown[] }[] };
  const had = before.groups.reduce((n, g) => n + g.sources.length, 0);
  // leave the section: no button pressed
  await page.getByRole("link", { name: /^Back to / }).click();
  await page.waitForURL(new RegExp(`/p/${id}\\?tab=talk$`)); // back to the course page, on the Let's talk! tab
  await expect.poll(async () => {
    const d = (await (await page.request.get(`/api/projects/${id}/sources`)).json()) as { groups: { sources: unknown[] }[]; pending: boolean };
    return d.pending === false && d.groups.reduce((n, g) => n + g.sources.length, 0) >= had;
  }, { timeout: 20_000 }).toBe(true);
  // its result is waiting in the "While you were away" card on the overview, and opens the Sources tab
  const away = page.getByRole("complementary", { name: "While you were away" });
  await expect(away.getByText(/Librarian/)).toBeVisible({ timeout: 15_000 });
  await expect(away.getByText(/(collected \d+ sources? on|found nothing new)/i)).toBeVisible();
  await shot(page, "v2-overview-while-away-1440.png");
  await away.getByRole("button", { name: /Librarian/ }).click();
  await page.waitForURL(/\/talk\?tab=sources$/);
  // dismissed for good once closed
  await page.goto(`/p/${id}`);
  await page.getByRole("complementary", { name: "While you were away" }).getByRole("button", { name: "Dismiss" }).click();
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("complementary", { name: "While you were away" }).getByText(/Librarian/)).toHaveCount(0);
});

test("Notepad: headings and bullets, autosave, search, and it is still there after a reload", async ({ page }) => {
  await page.goto(`/p/${id}/talk?tab=notepad`);
  await page.waitForLoadState("networkidle");
  const pad = page.getByRole("textbox", { name: "Notepad" });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await pad.click();
  await page.getByRole("button", { name: "Heading" }).click();
  await page.keyboard.type("Madison on faction");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Bullets" }).click();
  await page.keyboard.type("a large republic dilutes faction");
  await page.keyboard.press("Enter");
  await page.keyboard.type("representatives refine opinion");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // leaves the list
  await page.keyboard.type("A plain line about Hamilton.");
  await expect(page.getByRole("status").filter({ hasText: "Saving…" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 5_000 });
  await expect(pad.locator("h2")).toHaveText("Madison on faction");
  await expect(pad.locator("li")).toHaveCount(2);
  await shot(page, "v2-talk-notepad-1440.png");

  // full page: side margins match the header, the toolbar spans the page with "Saved" at its far right, the writing area fills the height
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const head = await box(".m-tt-head");
  const headPad = await page.locator(".m-tt-head").first().evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft));
  const tools = await box(".m-np-tools");
  const status = await page.locator(".m-np-status").boundingBox();
  const area = await pad.boundingBox();
  const body = await box(".m-np-body");
  expect(Math.abs(area!.x - (head.x + headPad))).toBeLessThanOrEqual(1);
  expect(Math.abs(area!.x + area!.width - (head.x + head.width - headPad))).toBeLessThanOrEqual(1);
  expect(Math.abs(tools.x + tools.width - (area!.x + area!.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(status!.x + status!.width - (tools.x + tools.width))).toBeLessThanOrEqual(1);
  expect(area!.y + area!.height).toBeGreaterThanOrEqual(body.y + body.height - 1);
  // clicking in the empty space below the text keeps typing at the end
  await page.mouse.click(area!.x + area!.width / 2, Math.min(area!.y + area!.height - 20, body.y + body.height - 20));
  await page.keyboard.type(" Typed below.");
  await expect(pad).toContainText("A plain line about Hamilton. Typed below.");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(pad.locator("h2")).toHaveText("Madison on faction");
  await expect(pad.locator("li")).toHaveText(["a large republic dilutes faction", "representatives refine opinion"]);
  await expect(pad).toContainText("A plain line about Hamilton.");

  await page.getByRole("searchbox", { name: "Search the notepad" }).fill("faction");
  const hits = page.getByLabel("Search results");
  await expect(hits.getByText("2 lines")).toBeVisible();
  await hits.getByRole("button", { name: /large republic/ }).click();
  await page.getByRole("searchbox", { name: "Search the notepad" }).fill("zzzz");
  await expect(hits.getByText("No lines contain that.")).toBeVisible();
  await shot(page, "v2-talk-notepad-search-1440.png");

  // one page per project: another project has its own empty page
  await page.goto("/");
  const other = await seedProject(page.request, "Another Course");
  await page.goto(`/p/${other}/talk?tab=notepad`);
  await expect(page.getByRole("textbox", { name: "Notepad" })).toHaveText("");
});

test("at 1024 the section fits and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const tab of ["chat", "sources", "notepad"]) {
    await page.goto(`/p/${id}/talk?tab=${tab}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), tab).toBeLessThanOrEqual(0);
    await shot(page, `v2-talk-${tab}-1024.png`);
  }
});
