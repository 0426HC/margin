import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// The Lecture tab: three tabs on every layer, written the first time it is opened from the layer's lecture files only, the student's own
// lecture notes filtered to the layer, and "Refresh this layer". Fake engine, throwaway data folder.
test.describe.configure({ mode: "serial" });

let id = "";
let layers: string[] = [];
/** A layer that holds the lecture slides, and one that doesn't. */
let withLecture = "";
let without = "";

const lectureLayers = () =>
  new Set(dbAll<{ id: string }>("select distinct l.id from layers l join layer_passages lp on lp.layer_id = l.id join passages p on p.id = lp.passage_id join files f on f.id = p.file_id join parts pt on pt.id = l.part_id where pt.project_id = ? and f.name like '%slides%'", id).map((r) => r.id));

test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Lecture Course");
  const page = await browser.newPage();
  layers = await layerIdsOf(page, id);
  await page.close();
  const has = lectureLayers();
  withLecture = layers.find((l) => has.has(l))!;
  without = layers.find((l) => !has.has(l))!;
  for (const l of layers) expect((await request.post(`/api/layers/${l}/write`)).ok()).toBe(true); // every layer has its tabs, so new material can be flagged on any of them
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const tabs = (page: Page) => page.getByRole("tablist", { name: "Show this layer as" });
const open = async (page: Page, layer: string) => {
  await page.goto(`/p/${id}/l/${layer}`);
  await expect(tabs(page)).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
};

test("every layer has three tabs: Explained, Lecture, Source", async ({ page }) => {
  // a layer without lecture files: walking onto its Lecture tab writes nothing, so the next test starts from no lecture written
  // (on a production build the write for a lecture layer finishes before the page closes; on the dev server it happened not to)
  await open(page, without);
  expect(await tabs(page).getByRole("tab").allTextContents()).toEqual(["Explained", "Lecture", "Source"]);
  // keyboard: the arrow keys walk the three
  await tabs(page).getByRole("tab", { name: "Explained" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).getByRole("tab", { name: "Lecture" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs(page).getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
  await tabs(page).getByRole("tab", { name: "Explained" }).click();
});

test("the Lecture tab is written only when it is first opened, from the lecture files, with counted numbers and checked citations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  expect(dbCount("select count(*) from layer_lecture")).toBe(0); // opening Explained and Source never writes it
  await open(page, withLecture);
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "By the numbers" })).toBeVisible({ timeout: 30_000 });
  for (const h of ["Where the lecture spent its time", "What it repeated", "What it flagged as important", "The examples it used", "Where it differs from the reading"]) await expect(panel.getByRole("heading", { name: h })).toBeVisible();
  await expect(panel.getByText("Counted by Margin from your slides.")).toBeVisible();
  expect(dbCount("select count(*) from layer_lecture where layer_id = ?", withLecture)).toBe(1);
  expect(dbCount("select count(*) from layer_lecture")).toBe(1); // only this layer

  // the counted numbers are about the real deck: nine slides, and the lines the deck itself words as a question or an example are copied as written
  const facts = JSON.parse(dbAll<{ facts: string }>("select facts from layer_lecture where layer_id = ?", withLecture)[0].facts) as { slides: number; files: { name: string }[] };
  expect(facts.files.map((f) => f.name)).toEqual(["Lecture 3 slides.pptx"]);
  expect(facts.slides).toBeGreaterThan(0);

  // a citation in the margin opens that slide in the original
  await panel.locator(".m-cite").first().click();
  await expect(page.getByRole("dialog").or(page.getByRole("complementary", { name: /original|source/i })).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // reopening it asks nothing again: the same row, the same time
  const written = dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", withLecture)[0].written_at;
  await page.reload();
  await expect(tabs(page).getByRole("tab", { name: "Lecture" })).toHaveAttribute("aria-selected", "true"); // the choice is remembered per layer
  await expect(page.getByRole("tabpanel").getByRole("heading", { name: "By the numbers" })).toBeVisible();
  expect(dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", withLecture)[0].written_at).toBe(written);
  expect(errors).toEqual([]);
});

test("a layer with no lecture files says so and offers Add files", async ({ page }) => {
  await open(page, without);
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "No lecture files for this layer yet" })).toBeVisible();
  expect(dbCount("select count(*) from layer_lecture where layer_id = ?", without)).toBe(0);
  await panel.getByRole("button", { name: "Add files" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add files" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await tabs(page).getByRole("tab", { name: "Explained" }).click();
});

test("the student's own lecture notes appear under 'From your class notes · Week N', filtered, in their words, with a gentle second look", async ({ page, request }) => {
  const put = (week: number, blocks: unknown) => request.put(`/api/projects/${id}/weeks/${week}/notes`, { data: { blocks } });
  expect((await put(3, [{ type: "bullet", text: "ambition -> counters ambition" }, { type: "bullet", text: "the veto DIFFERS from what I thought" }, { type: "paragraph", text: "lunch was off topic" }])).ok()).toBe(true);
  await open(page, withLecture);
  await expect(tabs(page).getByRole("tab", { name: "Lecture" })).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "From your class notes · Week 3" })).toBeVisible({ timeout: 30_000 });
  const own = panel.getByRole("region", { name: "From your class notes, Week 3" });
  await expect(own.getByText("ambition → counters ambition")).toHaveCount(0); // the arrow was typed in the notepad, not here: the line is copied exactly as stored
  await expect(own.getByText("ambition -> counters ambition")).toBeVisible();
  await expect(own.getByText("lunch was off topic")).toHaveCount(0); // not about this layer
  await expect(own.getByText(/These are not the professor’s words/)).toBeVisible();
  await expect(panel.getByRole("region", { name: "A second look" }).getByText(/Worth a second look/)).toBeVisible();

  // editing the lecture notes makes the section again (only that section), without writing the lecture a second time
  const written = dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", withLecture)[0].written_at;
  expect((await put(3, [{ type: "bullet", text: "a brand new line about ambition" }])).ok()).toBe(true);
  await open(page, withLecture);
  await expect(panel.getByText("a brand new line about ambition")).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText("ambition -> counters ambition")).toHaveCount(0);
  expect(dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", withLecture)[0].written_at).toBe(written);
});

test("lecture notes are used only on the Lecture tab", async ({ page }) => {
  await open(page, withLecture);
  await tabs(page).getByRole("tab", { name: "Explained" }).click();
  await expect(page.getByText("a brand new line about ambition")).toHaveCount(0);
  await tabs(page).getByRole("tab", { name: "Source" }).click();
  await expect(page.getByText("a brand new line about ambition")).toHaveCount(0);
});

async function addLecture(request: APIRequestContext, name: string) {
  const text = `# Lecture 3 more\n\n${Array.from({ length: 70 }, (_, i) => `Extra slide point ${i} on ambition and the separation of powers.`).join(" ")}\n`;
  const r = await request.post(`/api/projects/${id}/updates/stage`, { multipart: { file: { name, mimeType: "text/markdown", buffer: Buffer.from(text) }, relPath: name, type: "lecture", week: "3" } });
  const row = (await r.json()) as { id: string };
  const c = await request.post(`/api/projects/${id}/updates/commit`, { data: { staged: [{ fileId: row.id }], removals: [] } });
  expect(c.ok()).toBe(true);
}

test("Refresh this layer: new lecture material is flagged, and refreshing writes Explained and Lecture again but never the write-up", async ({ page, request }) => {
  // the student saves a write-up first
  const { thread } = (await (await request.post(`/api/layers/${withLecture}/submit`, { data: { text: "My own words about this layer, said plainly." } })).json()) as { thread: { latestWritebackId: string } };
  expect((await request.post(`/api/layers/${withLecture}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" } })).ok()).toBe(true);
  const saved = dbAll<{ id: string; text: string }>("select id, text from note_saves where target_id = ?", withLecture);

  await addLecture(request, "Lecture 3 more slides.md");
  const marked = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.new_material_at is not null", id).map((r) => r.id);
  expect(marked.length).toBe(1); // only the layer that took the new slides
  const layer = marked[0];
  await open(page, layer);
  await expect(page.getByText("New material since you saved.")).toBeVisible();
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  await expect(page.getByRole("tabpanel").getByRole("heading", { name: "By the numbers" })).toBeVisible({ timeout: 30_000 });
  const before = dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", layer)[0].written_at;
  await page.getByRole("button", { name: "Refresh this layer" }).click();
  await expect(page.getByText("New material since you saved.")).toHaveCount(0, { timeout: 30_000 });
  expect(dbAll<{ written_at: number }>("select written_at from layer_lecture where layer_id = ?", layer)[0].written_at).toBeGreaterThan(before);
  expect(dbCount("select count(*) from layers where id = ? and new_material_at is null", layer)).toBe(1);
  expect(dbAll<{ id: string; text: string }>("select id, text from note_saves where target_id = ?", withLecture)).toEqual(saved); // the write-up is exactly as saved
});

test("the demo's lecture layer shows its tab too", async ({ page, request }) => {
  const { id: demo } = (await (await request.post("/api/demo")).json()) as { id: string };
  const l = dbAll<{ id: string }>("select distinct l.id from layers l join layer_passages lp on lp.layer_id = l.id join passages p on p.id = lp.passage_id join files f on f.id = p.file_id join parts pt on pt.id = l.part_id where pt.project_id = ? and f.name like '%slides%'", demo);
  expect(l.length).toBeGreaterThan(0);
  await page.goto(`/p/${demo}/l/${l[0].id}`);
  await expect(tabs(page)).toBeVisible({ timeout: 30_000 });
  await tabs(page).getByRole("tab", { name: "Lecture" }).click();
  await expect(page.getByRole("tabpanel").getByRole("heading", { name: "By the numbers" })).toBeVisible({ timeout: 30_000 });
});
