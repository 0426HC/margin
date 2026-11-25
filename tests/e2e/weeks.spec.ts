import { expect, test, type Page } from "@playwright/test";
import { dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// Lecture notes: the rolling counter, one notepad page per week, plain tabs, and the way back. Fake engine, throwaway data folder.
test.describe.configure({ mode: "serial" });

let id = "";
test.beforeAll(async ({ request }) => {
  id = await seedProject(request, "Weeks Course");
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const counter = (page: Page) => page.getByRole("region", { name: /^Weeks\. Scroll/ });

test("the workspace side menu opens Lecture notes: a rolling counter that starts at 1", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const [layer] = await layerIdsOf(page, id);
  await page.goto(`/p/${id}/l/${layer}`);
  await page.getByRole("link", { name: "Lecture notes" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/lecture-notes$`));
  await expect(page.getByRole("heading", { name: "Lecture notes" })).toBeVisible();
  await expect(page.locator(".wk-week")).toHaveText("Week 1");
  await expect(page.locator(".wk-status")).toHaveText("No notes yet");
  // the number is one big link, and nothing else on the page is printed as a date or a label
  await expect(page.getByRole("link", { name: "Open the notes for Week 1" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("scrolling rolls the counter smoothly to the last week, and clicking the number opens that week", async ({ page }) => {
  await page.goto(`/p/${id}/lecture-notes`);
  const strip = page.locator(".wk-strip");
  await expect(strip).toBeVisible();
  const y0 = await strip.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
  const box = (await counter(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 150);
  await expect(async () => {
    const y = await strip.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    expect(y).toBeLessThan(y0);
  }).toPass();
  await counter(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator(".wk-week")).toHaveText("Week 3", { timeout: 10_000 }); // the sample course has three weeks, so the counter stops at 3
  await page.getByRole("link", { name: "Open the notes for Week 3" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/lecture-notes/3$`));
});

test("a week is a notepad: plain tabs, autosave, headings, bullets and -> becomes an arrow", async ({ page }) => {
  await page.goto(`/p/${id}/lecture-notes/3`);
  const tabs = page.getByRole("tablist", { name: "Weeks" });
  // plain "Week 1" to "Week 3": no dates, dots or labels on the tabs
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  expect(await tabs.getByRole("tab").allTextContents()).toEqual(["Week 1", "Week 2", "Week 3"]);
  await expect(tabs.getByRole("tab", { name: "Week 3" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "All weeks" }).or(page.getByRole("link", { name: "All weeks" }))).toBeVisible();

  const pad = page.getByRole("textbox", { name: "Notes for Week 3" });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await pad.click();
  await page.keyboard.type("Ambition -> counters ambition");
  await expect(pad).toContainText("Ambition → counters ambition");
  await page.getByRole("button", { name: "Bullets" }).click();
  await page.keyboard.type("one point");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  expect(dbCount("select count(*) from week_notes where project_id = ? and week = 3", id)).toBe(1);
  const stored = dbAll<{ blocks: string }>("select blocks from week_notes where project_id = ? and week = 3", id)[0].blocks;
  expect(stored).toContain("Ambition → counters ambition");
  expect(stored).toContain('"type":"bullet"');
  expect(stored).not.toContain("<"); // text and structure only, never markup

  // another week is its own page
  await tabs.getByRole("tab", { name: "Week 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/lecture-notes/1$`));
  await expect(page.getByRole("textbox", { name: "Notes for Week 1" })).toHaveText("");
  await page.reload();
  await tabs.getByRole("tab", { name: "Week 3" }).click();
  await expect(page.getByRole("textbox", { name: "Notes for Week 3" })).toContainText("one point");
});

test("All weeks goes back to the counter, which now says that week has notes", async ({ page }) => {
  await page.goto(`/p/${id}/lecture-notes/3`);
  await page.getByRole("link", { name: "All weeks" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/lecture-notes\\?at=3$`));
  await expect(page.locator(".wk-week")).toHaveText("Week 3");
  await expect(page.locator(".wk-status")).toHaveText("Has notes");
  // and back to the start when the section is opened from the menu
  await page.goto(`/p/${id}/lecture-notes`);
  await expect(page.locator(".wk-week")).toHaveText("Week 1");
});

test("with reduced motion the counter is a plain list of the weeks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/p/${id}/lecture-notes`);
  const list = page.getByRole("list", { name: "Weeks" });
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(list.getByRole("link", { name: /Week 3.*Has notes/ })).toBeVisible();
  await expect(page.locator(".wk-strip")).toHaveCount(0);
  await list.getByRole("link", { name: /Week 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/lecture-notes/2$`));
});

test("a week that isn't in the course is not found", async ({ page }) => {
  await page.goto(`/p/${id}/lecture-notes/9`);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Weeks" })).toHaveCount(0);
});

test("the demo takes lecture notes too, kept local", async ({ page, request }) => {
  const { id: demo } = (await (await request.post("/api/demo")).json()) as { id: string };
  const r = await request.put(`/api/projects/${demo}/weeks/1/notes`, { data: { blocks: [{ type: "paragraph", text: "demo note" }] } });
  expect(r.ok()).toBe(true);
  await page.goto(`/p/${demo}/lecture-notes`);
  await expect(page.locator(".wk-status")).toHaveText("Has notes");
});
