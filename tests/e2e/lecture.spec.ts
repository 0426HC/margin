import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dbAll, dbCount, seedProject } from "./helpers";

// The week's Lecture tab: the same in every layer of a week, in two sections ("From your lecture notes", "From the lecture material"),
// streamed in when opened, written again only when the notes stop changing or the week's files change. Fake engine (MARGIN_LECTURE_QUIET_S
// is 4 seconds here), throwaway data folder. The sample course: week 1 a reading only (no tab), week 2 a reading and the student's notes
// file (notes only), week 3 a reading and the lecture deck (material; notes are added below).
test.describe.configure({ mode: "serial" });

let id = "";
const layersOf = (week: number) =>
  dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and p.week = ? and l.proposed = 0 order by l.position", id, week).map((r) => r.id);
const rows = (week: number) => dbAll<{ part: string; text: string; written_at: number }>("select part, text, written_at from week_lecture where project_id = ? and week = ? order by part", id, week);
const putNotes = (request: APIRequestContext, week: number, lines: string[], left = false) =>
  request.put(`/api/projects/${id}/weeks/${week}/notes`, { data: { blocks: lines.map((text) => ({ type: "bullet", text })), ...(left ? { left } : {}) } });

test.beforeAll(async ({ request }) => {
  id = await seedProject(request, "Lecture Course");
  for (const l of [...layersOf(1), ...layersOf(2), ...layersOf(3)]) expect((await request.post(`/api/layers/${l}/write`)).ok()).toBe(true);
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const tabs = (page: Page) => page.getByRole("tablist", { name: "Show this layer as" });
const open = async (page: Page, layer: string) => {
  await page.goto(`/p/${id}/l/${layer}`);
  await expect(tabs(page)).toBeVisible({ timeout: 30_000 });
};
const openLecture = async (page: Page, layer: string) => {
  await open(page, layer);
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  return page.getByRole("tabpanel");
};

test("a week with neither lecture notes nor lecture material has no Lecture tab", async ({ page }) => {
  await open(page, layersOf(1)[0]);
  expect(await tabs(page).getByRole("tab").allTextContents()).toEqual(["Explained", "Source"]);
  expect(dbCount("select count(*) from week_lecture where project_id = ?", id)).toBe(0);
});

test("lecture material but no notes: the material section streams in, with one line inviting notes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const panel = await openLecture(page, layersOf(3)[0]);
  const notes = panel.getByRole("region", { name: "From your lecture notes" });
  await expect(notes.getByText("Take notes in Lecture notes during class and this section fills in.")).toBeVisible();
  await expect(notes.getByRole("link", { name: "Lecture notes" })).toHaveAttribute("href", `/p/${id}/lecture-notes/3`);
  const material = panel.getByRole("region", { name: "From the lecture material" });
  for (const h of ["What it spent its time on", "What it stressed", "The examples it used", "Where it differs from the readings"]) await expect(material.getByRole("heading", { name: h })).toBeVisible({ timeout: 30_000 });
  expect(rows(3).map((r) => r.part)).toEqual(["material"]);

  // a citation in the margin opens that slide in the original
  await material.locator(".m-cite").first().click();
  await expect(page.getByRole("dialog").or(page.getByRole("complementary", { name: /original|source/i })).first()).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("every layer of the week shows the same tab, written once", async ({ page }) => {
  const layers = layersOf(3);
  const written = rows(3)[0].written_at;
  const texts: string[] = [];
  for (const l of layers) {
    const panel = await openLecture(page, l);
    const material = panel.getByRole("region", { name: "From the lecture material" });
    await expect(material.getByRole("heading", { name: "What it stressed" })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("Week 3. The same in every layer of this week.")).toBeVisible();
    texts.push(await material.innerText());
  }
  expect(new Set(texts).size).toBe(1);
  expect(rows(3)[0].written_at).toBe(written); // opened from every layer, never written again
  // the choice of tab is remembered per layer
  await page.reload();
  await expect(tabs(page).getByRole("tab", { name: "Lecture" })).toHaveAttribute("aria-selected", "true");
});

test("notes but no lecture material: the notes section only", async ({ page }) => {
  expect(dbCount("select count(*) from week_notes where project_id = ? and week = 2", id)).toBe(1); // the student's notes file, copied in at import
  const panel = await openLecture(page, layersOf(2)[0]);
  const notes = panel.getByRole("region", { name: "From your lecture notes" });
  await expect(notes.locator("li").first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("region", { name: "From the lecture material" })).toHaveCount(0);
  expect(rows(2).map((r) => r.part)).toEqual(["notes"]);
});

test("short class notes are expanded from the week's files and pointed back to them; a point only in the notes is marked, never cited", async ({ page }) => {
  // the student writes two short lines in class, then leaves the Lecture notes page
  await page.goto(`/p/${id}/lecture-notes/3`);
  const pad = page.getByRole("textbox", { name: "Notes for Week 3" });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await pad.click();
  await page.getByRole("button", { name: "Bullets" }).click();
  await page.keyboard.type("ambition counteract ambition");
  await page.keyboard.press("Enter");
  await page.keyboard.type("prof's dog came to class");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  expect(rows(3).map((r) => r.part)).toEqual(["material"]); // nothing written while the student types
  await page.goto(`/p/${id}`); // leaving the page writes the notes section now, not after the quiet time
  await expect.poll(() => rows(3).map((r) => r.part), { timeout: 15_000 }).toEqual(["material", "notes"]);

  const panel = await openLecture(page, layersOf(3)[0]);
  const notes = panel.getByRole("region", { name: "From your lecture notes" });
  const expanded = notes.locator(".m-row").filter({ hasText: "ambition counteract ambition" });
  await expect(expanded).toBeVisible({ timeout: 30_000 });
  await expect(expanded.locator(".m-cite")).not.toHaveCount(0); // the readings or slides that cover it, in the margin
  const own = notes.locator("li").filter({ hasText: "dog" });
  await expect(own.locator(".m-lec-own")).toHaveText("(from your notes)");
  expect(rows(3).find((r) => r.part === "notes")!.text).toMatch(/dog came to class\. \(from your notes\)$/m);
  await expect(panel.getByRole("region", { name: "From the lecture material" })).toBeVisible(); // both sections
});

test("the notes section is written again only once editing stops, and the old version shows, marked as updating, until the new one streams in", async ({ page, request }) => {
  const before = rows(3).find((r) => r.part === "notes")!;
  // autosaves while typing: nothing is written until the notes have been quiet for the quiet time
  expect((await putNotes(request, 3, ["ambition counteract ambition", "edit one"])).ok()).toBe(true);
  await page.waitForTimeout(1_500);
  expect((await putNotes(request, 3, ["ambition counteract ambition", "edit two"])).ok()).toBe(true);
  await page.waitForTimeout(2_500); // 4 s since the first save, but only 2.5 s since the last
  expect(rows(3).find((r) => r.part === "notes")!.written_at).toBe(before.written_at);
  await expect.poll(() => rows(3).find((r) => r.part === "notes")!.text, { timeout: 15_000 }).toContain("edit two");

  // opened while the notes changed (slowly streamed by the fake engine): the previous version stays, with a small updating line
  expect((await putNotes(request, 3, ["ambition counteract ambition", "edit three (fake: slow)"])).ok()).toBe(true);
  const panel = await openLecture(page, layersOf(3)[0]);
  const notes = panel.getByRole("region", { name: "From your lecture notes" });
  await expect(notes.getByRole("status")).toHaveText(/Updating from your latest notes/, { timeout: 10_000 });
  await expect(notes.getByText(/edit two/)).toBeVisible();
  await expect(notes.getByText(/edit three/)).toBeVisible({ timeout: 30_000 }); // the new version streams in, in place of the old
  await expect(notes.getByText(/edit two/)).toHaveCount(0);
  await expect(notes.getByRole("status")).toHaveCount(0, { timeout: 40_000 }); // and the updating line goes once it is saved
});

test("lecture notes are used only on the Lecture tab", async ({ page }) => {
  await open(page, layersOf(3)[0]);
  await tabs(page).getByRole("tab", { name: "Explained" }).click();
  await expect(page.getByText("dog came to class")).toHaveCount(0);
  await tabs(page).getByRole("tab", { name: "Source" }).click();
  await expect(page.getByText("dog came to class")).toHaveCount(0);
});

test("two lectures in a week: the material section is written again when the week's lecture files change, one part per lecture", async ({ page, request }) => {
  const text = `# Lecture 3b: the senate\n\n${Array.from({ length: 70 }, (_, i) => `The senate checks the house on point ${i}. Important: a second chamber slows hasty law.`).join(" ")}\n`;
  const r = await request.post(`/api/projects/${id}/updates/stage`, { multipart: { file: { name: "Lecture 3b slides.md", mimeType: "text/markdown", buffer: Buffer.from(text) }, relPath: "Lecture 3b slides.md", type: "lecture", week: "3" } });
  const staged = (await r.json()) as { id: string };
  expect((await request.post(`/api/projects/${id}/updates/commit`, { data: { staged: [{ fileId: staged.id }], removals: [] } })).ok()).toBe(true);
  // any new layer the file made is approved, so its passages sit in week 3
  await request.post(`/api/projects/${id}/structure/approve`, { data: {} });
  const panel = await openLecture(page, layersOf(3)[0]);
  const material = panel.getByRole("region", { name: "From the lecture material" });
  await expect(material.getByRole("heading", { name: "Lecture 3b slides", level: 4 })).toBeVisible({ timeout: 30_000 });
  await expect(material.getByRole("heading", { name: "Lecture 3 slides", level: 4 })).toBeVisible();
  await expect(material.getByRole("heading", { name: "What it stressed" })).toHaveCount(2);
});

test("the demo's lecture week shows its Lecture tab too", async ({ page, request }) => {
  const { id: demo } = (await (await request.post("/api/demo")).json()) as { id: string };
  const l = dbAll<{ id: string }>("select distinct l.id from layers l join layer_passages lp on lp.layer_id = l.id join passages p on p.id = lp.passage_id join files f on f.id = p.file_id join parts pt on pt.id = l.part_id where pt.project_id = ? and f.name like '%slides%'", demo);
  expect(l.length).toBeGreaterThan(0);
  await page.goto(`/p/${demo}/l/${l[0].id}`);
  await expect(tabs(page)).toBeVisible({ timeout: 30_000 });
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  await expect(page.getByRole("tabpanel").getByRole("region", { name: "From the lecture material" }).getByRole("heading", { name: "What it stressed" })).toBeVisible({ timeout: 30_000 });
});
