import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// Agent requests: one button under the agents' table on the overview's first scene, a side panel, routing, refusal of graded work,
// Ready for you with open, PDF, Word and delete, and "While you were away". Fake engine, throwaway data folder.
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
test.describe.configure({ mode: "serial" });

let id = "";
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Agents Course");
  const page = await browser.newPage();
  await layerIdsOf(page, id);
  await page.close();
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const panel = (page: Page) => page.getByRole("dialog", { name: "The agents" });
const openPanel = async (page: Page) => {
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Leave a note for the agents" }).click();
  await expect(panel(page)).toBeVisible();
};

test("the first scene gets one button under the agents' table and a Ready for you link, and nothing else changes", async ({ page }) => {
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  const intro = page.locator(".ov-intro");
  await expect(intro.getByRole("heading", { level: 1 })).toContainText("Agents Course");
  await expect(intro.getByRole("button", { name: "Leave a note for the agents" })).toBeVisible();
  await expect(intro.getByRole("button", { name: /^Ready for you \(0\)$/ })).toBeVisible();
  // under the table, on the right: below the middle of the screen, in the right half
  const b = (await intro.getByRole("button", { name: "Leave a note for the agents" }).boundingBox())!;
  expect(b.y).toBeGreaterThan(600);
  expect(b.x).toBeGreaterThan(720);
  await expect(intro.locator(".ov-bar")).toBeVisible(); // the progress bar is where it was
  // it sits clear of the course title
  const h = (await intro.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(h.y + h.height - 4);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "agents-first-scene-1440.png") });
});

test("the panel has two tabs, a note box with suggestions, and a daily count", async ({ page }) => {
  await openPanel(page);
  const p = panel(page);
  await expect(p.getByRole("tab", { name: "Leave a note" })).toHaveAttribute("aria-selected", "true");
  await expect(p.getByRole("tab", { name: /^Ready for you \(0\)$/ })).toBeVisible();
  const chips = p.getByRole("group", { name: "Suggestions" }).getByRole("button");
  expect(await chips.count()).toBe(4);
  await chips.first().click();
  await expect(p.getByRole("textbox", { name: "Your note" })).toHaveValue(/study guide/);
  await expect(p.getByText(/\d+ of \d+ notes left today/)).toBeVisible();
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "agents-panel-note-1440.png") });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("graded work is refused kindly, with something to do instead, and nothing is recorded", async ({ page }) => {
  await openPanel(page);
  const p = panel(page);
  await p.getByRole("textbox", { name: "Your note" }).fill("Write my essay on faction, it is due tomorrow");
  await p.getByRole("button", { name: "Send to the agents" }).click();
  const no = p.getByRole("alert");
  await expect(no).toContainText("can't write work that you hand in for a grade");
  await no.getByRole("button", { name: "Make this instead" }).click();
  await expect(p.getByRole("textbox", { name: "Your note" })).toHaveValue(/essay plan checklist/);
  expect(dbCount("select count(*) from agent_requests")).toBe(0);
});

test("a note is routed to an agent, the dining hall and the card announce the result, and it waits in Ready for you", async ({ page }) => {
  await openPanel(page);
  const p = panel(page);
  await p.getByRole("textbox", { name: "Your note" }).fill("A one-page study guide for week 1, in plain words");
  await p.getByRole("button", { name: "Send to the agents" }).click();
  await expect(p.getByRole("status").filter({ hasText: /Sent to the Explainer/ })).toBeVisible();
  expect(dbAll<{ agent: string }>("select agent from agent_requests")[0].agent).toBe("explainer");
  // announced: the existing While you were away card, and the count on the link
  await page.keyboard.press("Escape");
  const away = page.getByRole("complementary", { name: "While you were away" });
  await expect(away).toContainText("Explainer", { timeout: 20_000 });
  await expect(away).toContainText(/made “/i);
  await expect(page.getByRole("button", { name: /^Ready for you \(1\)$/ })).toBeVisible({ timeout: 20_000 });
  // the agent's task is recorded for the dining hall
  expect(dbAll<{ kind: string; status: string }>("select kind, status from agent_tasks where kind = 'make-document'")[0]).toMatchObject({ status: "done" });

  // the card opens the document in the panel's second tab
  await away.getByRole("list").getByRole("button").first().click();
  await expect(panel(page).getByRole("tab", { name: /Ready for you \(1\)/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByRole("list").getByText(/Made by the Explainer/)).toBeVisible();
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "agents-panel-ready-1440.png") });
});

test("Ready for you: open a document, download it as PDF or Word, and delete it for good", async ({ page, request }) => {
  await openPanel(page);
  const p = panel(page);
  await p.getByRole("tab", { name: /Ready for you/ }).click();
  const item = p.getByRole("list").getByRole("listitem").first();
  const title = (await item.locator(".ap-title").innerText()).trim();
  // open
  await item.getByRole("button", { name: "Open" }).click();
  await expect(p.getByRole("heading", { name: title })).toBeVisible();
  await expect(p.locator(".ap-cite").first()).toContainText(/\[[^\]]+, p\. \d+\]/);
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "agents-panel-document-1440.png") });
  await p.getByRole("button", { name: "Back to Ready for you" }).click();
  // downloads
  const requestId = dbAll<{ id: string }>("select id from agent_requests where status = 'done'")[0].id;
  const pdf = await request.get(`/api/agent-requests/${requestId}/download?format=pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const docx = await request.get(`/api/agent-requests/${requestId}/download?format=docx`);
  expect(docx.headers()["content-type"]).toContain("wordprocessingml");
  expect((await docx.body()).subarray(0, 2).toString()).toBe("PK");
  await expect(item.getByRole("link", { name: /as PDF/ })).toHaveAttribute("href", /format=pdf/);
  await expect(item.getByRole("link", { name: /as Word/ })).toHaveAttribute("href", /format=docx/);
  // delete, with a styled confirm
  await item.getByRole("button", { name: /^Delete / }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this?" });
  await expect(confirm).toContainText("cannot be undone");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(p.getByText(/Nothing yet/)).toBeVisible({ timeout: 15_000 });
  expect(dbCount("select count(*) from agent_requests")).toBe(0);
});

test("a Librarian note is made by code, so it works without a model: verbatim passages with file and page", async ({ page }) => {
  await openPanel(page);
  const p = panel(page);
  await p.getByRole("textbox", { name: "Your note" }).fill("Find every passage about faction");
  await p.getByRole("button", { name: "Send to the agents" }).click();
  await expect(p.getByRole("status").filter({ hasText: /Sent to the Librarian/ })).toBeVisible();
  await p.getByRole("tab", { name: /Ready for you/ }).click();
  await expect(p.getByRole("list").getByText(/Made by the Librarian/)).toBeVisible({ timeout: 20_000 });
  expect(dbCount("select count(*) from agent_requests where agent = 'librarian' and status = 'done'")).toBe(1);
});

test("on a phone the button is there and the panel fills the width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Leave a note for the agents" }).click();
  const box = (await panel(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(385);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test("the demo takes notes too", async ({ page, request }) => {
  const { id: demo } = (await (await request.post("/api/demo")).json()) as { id: string };
  await page.goto(`/p/${demo}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Leave a note for the agents" })).toBeVisible();
});
