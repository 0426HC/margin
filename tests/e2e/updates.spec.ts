import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { courseFolder, dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// Add files and Update from folder, end to end with the fake engine and a throwaway data folder: the "What's new" review, nothing written
// until the student approves, labels and weeks, new layers to approve, exam sheets, and the saved write-up never changing.

test.describe.configure({ mode: "serial" });

// Chromium has the File System Access API, which opens a native picker a test cannot drive; with it hidden the page falls back to the folder input.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
  });
});

const dialog = (page: Page) => page.getByRole("dialog");

/** The sample course, changed the way a real folder changes between visits. */
function changedFolder() {
  const root = courseFolder();
  fs.appendFileSync(path.join(root, "Week 1 - Foundations", "federalist-01.txt"), "\n\nAn added closing paragraph about the union and the safety of the people, written later in the term.\n");
  fs.rmSync(path.join(root, "Week 3 - Checks and balances", "federalist-51.md"));
  fs.writeFileSync(path.join(root, "Week 3 - Checks and balances", "new topic.md"), `# A new topic\n\n${Array.from({ length: 90 }, (_, i) => `Sentence ${i} about something the course has not covered before.`).join(" ")}\n`);
  fs.writeFileSync(path.join(root, "Week 2 - Faction", "Lecture 2 slides.md"), `# Lecture 2\n\n${Array.from({ length: 60 }, (_, i) => `Slide point ${i} on faction and the large republic.`).join(" ")}\n`);
  fs.writeFileSync(path.join(root, "Midterm exam instructions.txt"), "Midterm exam instructions\n\nTime allowed: 90 minutes. Section A: multiple choice. Section B: essay. Marking guide: marks are awarded for use of the readings.\n");
  return root;
}

let projectId = "";
let layers: string[] = [];
let savedBefore: { id: string; text: string }[] = [];

test.beforeAll(async ({ request, browser }) => {
  projectId = await seedProject(request, "Updates Course");
  const page = await browser.newPage();
  layers = await layerIdsOf(page, projectId);
  await page.close();
  for (const id of layers) expect((await request.post(`/api/layers/${id}/write`)).ok()).toBe(true); // every layer has its tabs written, so new material can be marked
  const first = layers[0];
  const { thread } = (await (await request.post(`/api/layers/${first}/submit`, { data: { text: "My own words about the first layer, said plainly." } })).json()) as { thread: { latestWritebackId: string } };
  expect((await request.post(`/api/layers/${first}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" } })).ok()).toBe(true);
  savedBefore = dbAll<{ id: string; text: string }>("select id, text from note_saves");
});

test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`);
});

test("the overview keeps its page and gains two buttons, left of the continue button", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  const bar = page.locator(".ov-bar-top");
  const names = await bar.getByRole("button").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));
  expect(at(/^Update from folder$/)).toBeGreaterThan(-1);
  expect(at(/^Add files$/)).toBeGreaterThan(at(/^Update from folder$/));
  expect(at(/Start with the first layer|^Continue with/)).toBeGreaterThan(at(/^Add files$/));
  await expect(page.locator(".ov-intro")).toBeVisible(); // the opening scene is still there
  // focus is a plum ring, never the browser's own
  await page.getByRole("button", { name: "Update from folder" }).focus();
  await page.keyboard.press("Tab"); // reach it with the keyboard, so the browser shows its focus ring
  const ring = await page.getByRole("button", { name: "Add files" }).evaluate((el) => getComputedStyle(el).outlineColor);
  expect(ring).toBe("rgb(211, 138, 224)");
});

test("Update from folder: What's new lists new, changed, removed and the exam sheet, and writes nothing until approved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  const filesBefore = dbCount("select count(*) from files where project_id = ?", projectId);
  const layersBefore = dbCount("select count(*) from layers");

  await page.getByRole("button", { name: "Update from folder" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Update from folder" })).toBeVisible();
  await page.getByTestId("updates-folder-input").setInputFiles(changedFolder());

  await expect(dialog(page).getByRole("heading", { name: "What’s new" })).toBeVisible({ timeout: 30_000 });
  const d = dialog(page);
  await expect(d.getByRole("region", { name: "New files" }).getByText("new topic.md")).toBeVisible();
  await expect(d.getByRole("region", { name: "New files" }).getByText("Lecture 2 slides.md")).toBeVisible();
  await expect(d.getByRole("region", { name: "Changed files" }).getByText("federalist-01.txt")).toBeVisible();
  await expect(d.getByRole("region", { name: "Removed files" }).getByText("federalist-51.md")).toBeVisible();
  await expect(d.getByRole("region", { name: "Exam material" }).getByText("Midterm exam instructions.txt")).toBeVisible();
  await expect(d.getByText(/\d+ unchanged, skipped/)).toBeVisible();
  // each new file has a type and a reason from Claude, and any type can be changed
  await expect(d.getByRole("combobox", { name: "Type of Lecture 2 slides.md" })).toHaveValue("lecture");
  await expect(d.getByRole("combobox", { name: "Type of new topic.md" })).toHaveValue("reading");
  await d.getByRole("combobox", { name: "Type of new topic.md" }).selectOption("lecture");
  await expect(d.getByRole("combobox", { name: "Type of new topic.md" })).toHaveValue("lecture");
  // a changed file keeps the week and type of the file it replaces
  await expect(d.getByRole("region", { name: "Changed files" })).toContainText("keeps that file's week and type");
  // the week of a new file comes from its folder
  await expect(d.getByRole("combobox", { name: "Week for new topic.md" })).toHaveValue("3");
  await expect(d.getByRole("combobox", { name: "Week for Lecture 2 slides.md" })).toHaveValue("2");

  // nothing has been written yet
  expect(dbCount("select count(*) from files where project_id = ?", projectId)).toBe(filesBefore);
  expect(dbCount("select count(*) from layers")).toBe(layersBefore);

  // a skipped item is left out of the count
  const apply = d.getByRole("button", { name: /^Add \d+ changes? to the course$/ });
  const n = Number(((await apply.textContent()) ?? "").match(/\d+/)![0]);
  await d.getByRole("checkbox", { name: "Include Lecture 2 slides.md" }).uncheck();
  await expect(d.getByRole("button", { name: `Add ${n - 1} changes to the course` })).toBeVisible();
  await d.getByRole("checkbox", { name: "Include Lecture 2 slides.md" }).check();
  expect(errors).toEqual([]);
});

test("approving adds the files, marks the layers, proposes a new layer to approve, and never changes a saved write-up", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  const filesBefore = dbCount("select count(*) from files where project_id = ?", projectId);
  const layersBefore = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.proposed = 0", projectId).length;

  await page.getByRole("button", { name: "Update from folder" }).click();
  await page.getByTestId("updates-folder-input").setInputFiles(changedFolder());
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "What’s new" })).toBeVisible({ timeout: 30_000 });
  await d.getByRole("combobox", { name: "What to do with the passages of federalist-51.md" }).selectOption("remove");
  await d.getByRole("button", { name: /^Add \d+ changes? to the course$/ }).click();

  // the new topic is only proposed
  await expect(d.getByRole("heading", { name: "New layers to approve" })).toBeVisible({ timeout: 60_000 });
  expect(dbCount("select count(*) from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.proposed = 1", projectId)).toBe(1);
  await expect(d.getByText("Added to layers you already have")).toBeVisible();
  const title = d.getByRole("textbox", { name: /^Title of / });
  await title.fill("The new topic, in my words");
  await d.getByRole("button", { name: "Approve these" }).click();
  await expect(d.getByRole("heading", { name: "Your course is up to date" })).toBeVisible();
  await expect(d.getByText("Your saved write-ups were not changed.")).toBeVisible();
  await expect(d.getByText(/Midterm exam instructions\.txt/)).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();

  // the database says the same
  expect(dbCount("select count(*) from files where project_id = ?", projectId)).toBeGreaterThan(filesBefore - 1);
  const files = dbAll<{ name: string; role: string | null; week: number | null; unit_id: string | null }>("select name, role, week, unit_id from files where project_id = ?", projectId);
  const by = (name: string) => files.find((f) => f.name === name)!;
  expect(by("new topic.md")).toMatchObject({ week: 3 });
  expect(by("Lecture 2 slides.md")).toMatchObject({ role: "lecture", week: 2 });
  expect(by("Midterm exam instructions.txt")).toMatchObject({ role: "exam", unit_id: null });
  expect(files.find((f) => f.name === "federalist-51.md")).toBeUndefined();
  expect(dbCount("select count(*) from passages p join files f on f.id = p.file_id where f.name = 'Midterm exam instructions.txt'")).toBe(0);
  const layersAfter = dbAll<{ title: string }>("select l.title from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.proposed = 0", projectId);
  expect(layersAfter.length).toBeGreaterThan(layersBefore - 2); // one layer may have gone with the removed file; the new topic is in
  expect(layersAfter.map((l) => l.title)).toContain("The new topic, in my words");
  expect(dbAll<{ id: string; text: string }>("select id, text from note_saves")).toEqual(savedBefore); // the saved write-up is exactly as it was
  // every passage of the course's own material is in a layer (the syllabus is read for structure, never a layer)
  expect(dbCount("select count(*) from passages where id not in (select passage_id from layer_passages) and project_id = ? and file_id in (select id from files where category is null or category = 'course')", projectId)).toBe(0);

  // a layer that took new material says so, and Refresh this layer clears it without touching the write-up
  await page.goto(`/p/${projectId}`);
  const marked = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.new_material_at is not null and l.content_status != 'none'", projectId);
  expect(marked.length).toBeGreaterThan(0);
  await page.goto(`/p/${projectId}/l/${marked[0].id}`);
  await expect(page.getByText("New material since you saved.")).toBeVisible();
  await expect(page.getByLabel("New material since you saved").first()).toBeVisible(); // the mark in the layer list
  await page.getByRole("button", { name: "Refresh this layer" }).click();
  await expect(page.getByText("New material since you saved.")).toHaveCount(0, { timeout: 30_000 });
  expect(dbAll<{ id: string; text: string }>("select id, text from note_saves")).toEqual(savedBefore);
  expect(dbCount("select count(*) from layers where id = ? and new_material_at is null", marked[0].id)).toBe(1);
});

test("running the same update again finds nothing to do: unchanged files are skipped", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Update from folder" }).click();
  const root = changedFolder();
  // the folder as it now stands in the course: the changed file as it was updated, the removed file gone, the new ones in
  await page.getByTestId("updates-folder-input").setInputFiles(root);
  await expect(dialog(page).getByRole("heading", { name: "What’s new" })).toBeVisible({ timeout: 30_000 });
  // everything the first update added is now recognised by its fingerprint (not offered as new again)
  await expect(dialog(page).getByRole("region", { name: "New files" })).toHaveCount(0);
  await expect(dialog(page).getByRole("region", { name: "Changed files" })).toHaveCount(0);
  await expect(dialog(page).getByText(/\d+ unchanged, skipped/)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
});

test("Add files: the week dropdown lists every week plus 'Not sure', with Margin's suggestion chosen", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-add-")), "Week 2 extra reading.txt");
  fs.writeFileSync(f, `Extra reading\n\n${Array.from({ length: 80 }, (_, i) => `Extra sentence ${i} about the same faction.`).join(" ")}\n`);
  await page.getByRole("button", { name: "Add files" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Add files" })).toBeVisible();
  await page.getByTestId("updates-files-input").setInputFiles(f);
  const d = dialog(page);
  const week = d.getByRole("combobox", { name: "Which week are they for?" });
  await expect(week).toBeVisible({ timeout: 30_000 });
  const options = await week.locator("option").allTextContents();
  expect(options[0]).toBe("Not sure, let Margin decide");
  expect(options.slice(1).map((o) => o.split(" · ")[0])).toEqual(["Week 1", "Week 2", "Week 3"]); // the course has three weeks
  await expect(week).toHaveValue("2"); // Margin's suggestion, from the folder name
  await d.getByRole("button", { name: "Continue" }).click();
  await expect(d.getByRole("region", { name: "New files" }).getByText("Week 2 extra reading.txt")).toBeVisible();
  await expect(d.getByRole("combobox", { name: "Type of Week 2 extra reading.txt" })).toHaveValue("reading");
  await d.getByRole("button", { name: "Cancel" }).click();
});

test("the demo can be looked at but not changed", async ({ page, request }) => {
  const r = await request.post("/api/demo");
  const { id } = (await r.json()) as { id: string };
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Update from folder" }).click();
  await expect(dialog(page).getByText(/read-only/)).toBeVisible();
  await page.getByTestId("updates-folder-input").setInputFiles(changedFolder());
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "What’s new" })).toBeVisible({ timeout: 30_000 });
  await expect(d.getByRole("region", { name: "New files" })).toBeVisible();
  await expect(d.getByRole("button", { name: /^Add \d+ changes? to the course$/ })).toBeDisabled();
  await d.getByRole("button", { name: "Cancel" }).click();
  expect(dbCount("select count(*) from files where project_id = ? and name = 'new topic.md'", id)).toBe(0);
});
