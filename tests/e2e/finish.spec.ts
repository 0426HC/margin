import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { noStructure, pol326, pol326Later, writeCourse } from "../fixtures/courses";
import { dbAll } from "./helpers";

// The finishing round: a POL326-style folder imports with zero questions; a folder with nothing to go on asks one; later weeks arrive
// after the plan is approved and arrive in their own weeks; Enter sends. Fake engine, throwaway data folder.

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-finish-"));

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
  });
});

let projectId = "";
const made: string[] = [];
// leave nothing behind for the specs that run after this one
test.afterAll(async ({ request }) => {
  for (const id of [projectId, ...made].filter(Boolean)) await request.delete(`/api/projects/${id}`);
});

test("a POL326-style folder imports with zero questions: weeks titled from the syllabus, types, optional readings, my notes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // the form fades in after the title
  await page.getByText("How to set up your folder").click();
  await expect(page.getByLabel("An example course folder")).toBeVisible();
  await page.getByTestId("folder-input").setInputFiles(writeCourse(tmp(), "POL326", await pol326()));
  await expect(page.getByRole("status")).toHaveText("15 of 15 read", { timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  projectId = page.url().match(/\/p\/([^/]+)\//)![1];

  // no question, the plan is already there
  const sheet = page.locator(".m-paper");
  await expect(sheet.getByRole("region", { name: "Week 1 · Introduction" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "One question before the plan" })).toHaveCount(0);
  await expect(page.getByLabel("Number of weeks in this course")).toHaveValue("12");
  await expect(page.locator("main p.t-label").first()).toHaveText("POL326"); // the course code once, not "POL326, POL326."
  // all twelve weeks, the ones after the files stop saying so
  for (let w = 1; w <= 5; w++) expect(await sheet.getByRole("region", { name: new RegExp(`^Week ${w} · `) }).locator(".m-layer").count()).toBeGreaterThan(0);
  await expect(sheet.getByRole("region", { name: "Week 6 · Midterm exam, in class" })).toContainText("Material not added yet");
  await expect(sheet.getByRole("region", { name: "Week 12 · Review" })).toContainText("Material not added yet");

  // the files list: every week found, types read, my notes and the review guide (exam material) recognised
  await page.getByText("Files, weeks and types").click();
  for (let w = 1; w <= 5; w++) await expect(page.locator(".m-files-row").filter({ hasText: `POL326 Lecture ${w}.pptx` }).getByLabel(`Week of POL326 Lecture ${w}.pptx`)).toHaveValue(String(w));
  await expect(page.locator(".m-files-row").filter({ hasText: "Week 2 notes.docx" }).getByLabel("Type of Week 2 notes.docx")).toHaveValue("my-notes");
  await expect(page.locator(".m-files-row").filter({ hasText: "Midterm review guide.pdf" }).getByLabel("Type of Midterm review guide.pdf")).toHaveValue("exam");
  await expect(page.locator(".m-files-row").filter({ hasText: "Halberstam" }).getByLabel(/^Type of Halberstam/)).toHaveValue("optional");

  // an optional reading no layer covers can become an optional layer
  await expect(page.getByRole("heading", { name: "Optional readings on a topic of their own" })).toBeVisible();
  await page.getByRole("button", { name: "Add as optional layer" }).click();
  await expect(sheet.locator(".m-layer-tag", { hasText: "Optional layer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Optional readings on a topic of their own" })).toHaveCount(0);

  // no layer appears twice
  const titles = await sheet.locator(".m-layer .m-unit-title").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(new Set(titles).size).toBe(titles.length);

  await page.getByRole("button", { name: "Looks good" }).first().click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));

  // my notes are in week 2's Lecture notes
  await page.goto(`/p/${projectId}/lecture-notes/2`);
  await expect(page.getByText("Hamilton wants energy in the executive")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the sidebar lists the twelve weeks in order, the weeks without material quietly", async ({ page }) => {
  const layers = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? order by p.position, l.position", projectId);
  await page.goto(`/p/${projectId}/l/${layers[0].id}`);
  const side = page.getByRole("navigation", { name: "Layers" });
  expect((await side.locator(".m-lunit-title").allInnerTexts()).map((t) => t.split(" · ")[0])).toEqual(Array.from({ length: 12 }, (_, i) => `Week ${i + 1}`));
  await expect(side.locator(".m-wk-blank").filter({ hasText: "Week 7" })).toContainText("Material not added yet");
  await expect(page.getByText("Not tied to a week")).toHaveCount(0);
});

test("the number of weeks can be changed from the course's menu, and the files page changes a file's week", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: "This course has 12 weeks" }).click();
  const field = page.getByRole("dialog").getByLabel("Number of weeks in this course");
  await field.fill("13");
  await field.press("Enter");
  await expect(page.getByRole("dialog").getByText("Saved")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await page.goto(`/p/${projectId}/files`);
  await expect(page.getByLabel("Number of weeks in this course")).toHaveValue("13");
  const row = page.locator(".m-files-row").filter({ hasText: "Neustadt - Presidential Power.pdf" });
  await row.getByLabel("Week of Neustadt - Presidential Power.pdf").selectOption("2");
  await expect(page.locator(".m-files-row").filter({ hasText: "Neustadt - Presidential Power.pdf" }).getByLabel("Week of Neustadt - Presidential Power.pdf")).toHaveValue("2");
  expect(dbAll<{ week: number }>("select week from files where project_id = ? and name = 'Neustadt - Presidential Power.pdf'", projectId)[0].week).toBe(2);
});

test("later weeks after the plan is approved: What's new, then new layers in weeks 8 and 9 to approve", async ({ page }) => {
  await page.goto(`/p/${projectId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Update from folder" }).click();
  await page.getByTestId("updates-folder-input").setInputFiles(writeCourse(tmp(), "POL326", [...(await pol326()), ...(await pol326Later())]));
  const d = page.getByRole("dialog");
  await expect(d.getByRole("heading", { name: "What’s new" })).toBeVisible({ timeout: 60_000 });
  // working out that lecture 6 falls in week 8 (after the midterm and the reading week) is Claude's reading, tested with scripted answers
  // in the unit tests; here the offline stand-in can't, so the student sets the weeks, as they can for any file
  for (const [file, week] of [["POL326 Lecture 6.pptx", "8"], ["War Powers Resolution.pdf", "8"], ["POL326 Lecture 7.pptx", "9"], ["Marbury.pdf", "9"]]) {
    await d.getByRole("combobox", { name: `Week for ${file}` }).selectOption(week);
    await expect(d.getByRole("combobox", { name: `Week for ${file}` })).toHaveValue(week);
  }
  await d.getByRole("button", { name: /^Add \d+ changes? to the course$/ }).click();
  await expect(d.getByRole("heading", { name: "New layers to approve" })).toBeVisible({ timeout: 60_000 });
  await expect(d.getByText(/^Week 8 · War powers · /).first()).toBeVisible();
  await expect(d.getByText("Your Week 8 lecture covers something new: add it as a layer?")).toBeVisible();
  await d.getByRole("button", { name: "Approve these" }).click();
  await expect(d.getByRole("heading", { name: "Your course is up to date" })).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();
  const weeks = dbAll<{ week: number; breakdown_status: string }>("select week, breakdown_status from parts where project_id = ? order by position", projectId);
  expect(weeks).toEqual([1, 2, 3, 4, 5, 8, 9].map((week) => ({ week, breakdown_status: "approved" })));
});

test("Enter sends a write-back; Shift+Enter makes a new line", async ({ page }) => {
  const [layer] = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? order by p.position, l.position limit 1", projectId);
  await page.goto(`/p/${projectId}/l/${layer.id}`);
  const box = page.getByRole("textbox", { name: "Write this layer in your own words" });
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Enter submits, Shift+Enter makes a new line.")).toBeVisible();
  await box.fill("First line of my own words");
  await box.press("Shift+Enter");
  await box.pressSequentially("second line");
  await expect(box).toHaveValue("First line of my own words\nsecond line");
  await box.press("Enter");
  await expect(page.getByText("Send to Note to Self?").first()).toBeVisible({ timeout: 30_000 });
});

test("a folder with no syllabus and no week numbers: every file still gets a week, marked 'check this', and the plan goes ahead", async ({ page }) => {
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(writeCourse(tmp(), "Loose readings", await noStructure()));
  await expect(page.getByRole("status")).toHaveText("4 of 4 read", { timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/setup$/);
  made.push(page.url().match(/\/p\/([^/]+)\//)![1]);
  await expect(page.getByRole("region", { name: "One question before the plan" })).toHaveCount(0);
  await expect(page.locator(".m-paper").getByRole("region", { name: "Week 1", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Files, weeks and types")).toContainText("4 to check");
  await page.getByText("Files, weeks and types").click();
  await expect(page.locator(".m-files-row .m-check")).toHaveCount(4);
});
