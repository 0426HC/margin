import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePdf } from "../fixtures/build";
import { makeProject } from "./helpers";

const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

/** The sample course, plus a broken PDF and a spreadsheet, so the failure paths run too. */
function courseFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, root, { recursive: true });
  fs.writeFileSync(path.join(root, "Week 2 - Faction", "broken.pdf"), "this is not a pdf");
  fs.writeFileSync(path.join(root, "grades.xlsx"), "not a spreadsheet");
  return root;
}

test("import a folder: one review screen, already filled in, with the files' weeks and types, then Looks good", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  // hold each upload briefly so the live status can be seen (and photographed)
  if (SHOTS) await page.route("**/api/projects/*/files", async (route) => (await new Promise((r) => setTimeout(r, 450)), route.continue()));

  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // screenshots touch inputs, so let React hydrate first
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-import-start-1440.png") });
  await page.getByTestId("folder-input").setInputFiles(courseFolder());

  // live per-file status
  await expect(page.getByRole("heading", { name: "POL101 Federalist Seminar" })).toBeVisible();
  await expect(page.getByText("Reading", { exact: false }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-import-reading-1440.png") });

  await expect(page.getByRole("status")).toHaveText("8 of 8 read", { timeout: 30_000 });
  const rows = page.locator(".m-file-row");
  await expect(rows.filter({ hasText: "federalist-10-reader.pdf" })).toContainText("PDF · Read · 6 pages");
  await expect(rows.filter({ hasText: "Lecture 3 slides.pptx" })).toContainText("Read · 9 slides");
  await expect(rows.filter({ hasText: "broken.pdf" })).toContainText("Couldn't read");
  await expect(rows.filter({ hasText: "broken.pdf" })).toContainText("can't be read");
  await expect(rows.filter({ hasText: "grades.xlsx" })).toContainText("isn't a type Margin reads");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-import-done-1440.png"), fullPage: true });

  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];

  // one review screen, already filled in: what Margin read, the weeks, the files, the plan
  await expect(page.getByRole("heading", { name: "Your course plan" })).toBeVisible();
  await expect(page.getByText("Margin read 6 files: 3 weeks of lectures and readings, the syllabus, your notes for 1 week.")).toBeVisible();
  await expect(page.getByLabel("Number of weeks in this course")).toHaveValue("3");
  const sheet = page.locator(".m-paper");
  await expect(sheet.getByRole("region", { name: "Week 1 · Why a new government? Federalist No. 1" })).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-review-1440.png"), fullPage: true });

  // the files, each with its week, its type and why; any can be changed, and a change says the student set it
  await page.getByText("Files, weeks and types").click();
  const notes = page.locator(".m-files-row").filter({ hasText: "Study notes.docx" });
  await expect(notes.getByLabel("Type of Study notes.docx")).toHaveValue("my-notes");
  await expect(notes.locator(".m-file-reason")).toContainText("week 2");
  await expect(page.locator(".m-files-row").filter({ hasText: "Lecture 3 slides.pptx" }).getByLabel("Type of Lecture 3 slides.pptx")).toHaveValue("lecture");
  await expect(page.locator(".m-files-row").filter({ hasText: "federalist-10-reader.pdf" }).getByLabel("Week of federalist-10-reader.pdf")).toHaveValue("2");
  await notes.getByLabel("Type of Study notes.docx").selectOption("lecture");
  await expect(page.locator(".m-files-row").filter({ hasText: "Study notes.docx" }).getByLabel("Type of Study notes.docx")).toHaveValue("lecture");
  await expect(page.locator(".m-files-row").filter({ hasText: "Study notes.docx" }).locator(".m-file-reason")).toHaveText("You set this.");

  // the weeks are titled from the syllabus, then Looks good opens the course
  await expect(sheet.getByRole("region", { name: "Week 3 · Separation of powers and checks" })).toBeVisible();
  await page.getByRole("button", { name: "Looks good" }).first().click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));

  await page.goto("/");
  await expect(page.getByRole("button", { name: /POL101 Federalist Seminar/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the unit review still opens by its address: rename, move, merge and remove", async ({ page }) => {
  const projectId = await makeProject(page, { approve: false });
  await page.goto(`/p/${projectId}/import`);
  // the review step
  const sheet = page.locator(".m-paper");
  // units are named for the weeks as Claude read them in the syllabus
  for (const unit of ["Course overview", "Week 1: Why a new government? Federalist No. 1", "Week 2: Faction and the large republic", "Week 3: Separation of powers and checks"]) {
    await expect(sheet.getByRole("region", { name: unit })).toBeVisible();
  }
  await expect(sheet.getByText("FEDERALIST No. 1: General Introduction")).toBeVisible();
  await expect(sheet.getByText("FEDERALIST No. 10 (part 1 of 2)")).toBeVisible();

  // rename a unit
  const title = page.getByRole("textbox", { name: "Name of Week 1: Why a new government? Federalist No. 1" });
  await title.fill("Week 1: Why a new government");
  await title.press("Enter");
  await expect(sheet.getByRole("region", { name: "Week 1: Why a new government" })).toBeVisible();

  // move a file to another unit
  await page.getByLabel("Move federalist-51.md to another unit").selectOption({ label: "Week 1: Why a new government" });
  await expect(sheet.getByRole("region", { name: "Week 1: Why a new government" }).getByText("federalist-51.md")).toBeVisible();

  // merge two units
  await page.getByRole("button", { name: "Merge Week 2: Faction and the large republic into another unit" }).click();
  await page.getByLabel("Merge Week 2: Faction and the large republic into").selectOption({ label: "Week 1: Why a new government" });
  await page.getByRole("button", { name: "Merge Week 2: Faction and the large republic" }).click();
  await expect(sheet.getByRole("region", { name: "Week 2: Faction" })).toHaveCount(0);
  await expect(sheet.getByRole("region", { name: "Week 1: Why a new government" }).getByText("federalist-10-reader.pdf")).toBeVisible();

  // remove a file, with a confirmation
  await page.getByRole("button", { name: "Remove Lecture 3 slides.pptx" }).click();
  await page.getByRole("button", { name: "Yes, remove Lecture 3 slides.pptx" }).click();
  // role queries skip the hidden copy of the old page that Next keeps during a refresh
  await expect(page.getByRole("button", { name: "Remove Lecture 3 slides.pptx" })).toHaveCount(0);

});

test("a folder with nothing readable says so and lets you start over", async ({ page }) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-")), "Empty course");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "scan.pdf"), "not a pdf");
  await page.goto("/new");
  await page.getByTestId("folder-input").setInputFiles(dir);
  await expect(page.getByText("None of these files could be read")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
});

test("the review flags a PDF with poor text quality", async ({ page }) => {
  const noisy = Array.from({ length: 12 }, () => ({ text: "Tbe rnain @ spr1ngs ~ of acti0n | ar3 j r ' wlth brok3n w0rds f# &x" }));
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("files-input").setInputFiles({ name: "Week 1 scanned reader.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf([noisy, noisy, noisy])) });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/setup$/);
  // the unit review is no longer a step of its own, but it still opens by its address and still flags a poor scan
  await page.goto(page.url().replace(/\/setup$/, "/import"));
  await expect(page.getByText("Text quality: low, may be a scan.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-review-low-quality-1440.png") });
});
