import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePdf } from "../fixtures/build";

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

test("import a folder, check the units, edit them, and open the project", async ({ page }) => {
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

  await page.getByRole("button", { name: "Review units" }).click();
  await page.waitForURL(/\/p\/[^/]+\/import$/);

  // the review step
  const sheet = page.locator(".m-paper");
  for (const unit of ["Course overview", "Week 1: Foundations", "Week 2: Faction", "Week 3: Checks and balances"]) {
    await expect(sheet.getByRole("region", { name: unit })).toBeVisible();
  }
  await expect(page.getByText("1 file was left out")).toBeVisible();
  await expect(sheet.getByText("FEDERALIST No. 1: General Introduction")).toBeVisible();
  await expect(sheet.getByText("FEDERALIST No. 10 (part 1 of 2)")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-review-1440.png"), fullPage: true });

  // rename a unit
  const title = page.getByRole("textbox", { name: "Name of Week 1: Foundations" });
  await title.fill("Week 1: Why a new government");
  await title.press("Enter");
  await expect(sheet.getByRole("region", { name: "Week 1: Why a new government" })).toBeVisible();

  // move a file to another unit
  await page.getByLabel("Move Study notes.docx to another unit").selectOption({ label: "Week 3: Checks and balances" });
  await expect(sheet.getByRole("region", { name: "Week 3: Checks and balances" }).getByText("Study notes.docx")).toBeVisible();
  await expect(sheet.getByRole("region", { name: "Week 2: Faction" }).getByText("Study notes.docx")).toHaveCount(0);

  // merge two units
  await page.getByRole("button", { name: "Merge Week 2: Faction into another unit" }).click();
  await page.getByLabel("Merge Week 2: Faction into").selectOption({ label: "Week 1: Why a new government" });
  await page.getByRole("button", { name: "Merge Week 2: Faction" }).click();
  await expect(sheet.getByRole("region", { name: "Week 2: Faction" })).toHaveCount(0);
  await expect(sheet.getByRole("region", { name: "Week 1: Why a new government" }).getByText("federalist-10-reader.pdf")).toBeVisible();

  // remove a file, with a confirmation
  await page.getByRole("button", { name: "Remove Lecture 3 slides.pptx" }).click();
  await page.getByRole("button", { name: "Yes, remove Lecture 3 slides.pptx" }).click();
  // role queries skip the hidden copy of the old page that Next keeps during a refresh
  await expect(page.getByRole("button", { name: "Remove Lecture 3 slides.pptx" })).toHaveCount(0);

  // the review is done: next comes the plan for the layers (its own spec covers it)
  await page.getByRole("button", { name: "Plan the layers" }).first().click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  await expect(page.getByRole("heading", { name: "Plan the layers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Suggest the layers" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("button", { name: /POL101 Federalist Seminar/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
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
  await page.getByRole("button", { name: "Review units" }).click();
  await page.waitForURL(/\/import$/);
  await expect(page.getByText("Text quality: low, may be a scan.")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase2-review-low-quality-1440.png") });
});
