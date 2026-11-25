import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { dbAll, layerIdsOf, seedProject } from "./helpers";

// "Update exam details", end to end on the fake engine: not offered before setup; a prefilled panel; a note read into a proposed change;
// "What changes"; Confirm changes saves a new version; the past attempt is labelled "old format" and new practice uses the new format.
test.describe.configure({ mode: "serial" });

const SHEET = fs.readFileSync(path.join("demo", "exam", "POL101 Final exam instructions.md"));
const DETAILS = JSON.parse(fs.readFileSync(path.join("demo", "exam", "summary.json"), "utf8"));
let id = "";
let examId = "";
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Update Exam Course");
  const page = await browser.newPage();
  await layerIdsOf(page, id);
  await page.close();
  const r = await request.post(`/api/projects/${id}/exams`, { multipart: { file: { name: "Final exam instructions.md", mimeType: "text/markdown", buffer: SHEET } } });
  expect(r.ok()).toBe(true);
  examId = ((await r.json()) as { id: string }).id;
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

test("before the exam is set up there is no Update exam details", async ({ page, request }) => {
  await request.post(`/api/exams/${examId}/read`);
  await page.goto(`/p/${id}/exam?e=${examId}`);
  await expect(page.getByRole("button", { name: "This looks right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update exam details" })).toHaveCount(0);
});

test("the full flow: prefilled panel, a note, What changes, confirm, and the past attempt labelled old format", async ({ page, request }) => {
  // set up with the sheet's real details, write a set and sit it once
  expect((await request.put(`/api/exams/${examId}/summary`, { data: { summary: DETAILS, confirm: true } })).ok()).toBe(true);
  const { set } = (await (await request.post(`/api/exams/${examId}/sets`)).json()) as { set: { id: string } };
  const { attempt } = (await (await request.post(`/api/exam-sets/${set.id}/attempts`, { data: { timer: "none" } })).json()) as { attempt: { id: string } };
  expect((await request.post(`/api/exam-attempts/${attempt.id}/hand-in`, { data: { answers: {} } })).ok()).toBe(true);

  await page.goto(`/p/${id}/exam?e=${examId}`);
  await page.getByRole("button", { name: "Try again" }).or(page.getByRole("button", { name: "Enter the room" })).first().waitFor();
  if (await page.getByRole("button", { name: "Try again" }).isVisible()) await page.getByRole("button", { name: "Try again" }).click();
  const attempts = page.getByRole("region", { name: "Your attempts" });
  await expect(attempts.locator("li")).toHaveCount(1);
  await expect(attempts.getByText("old format")).toHaveCount(0);

  // the button sits at the top right, as an outline button
  const button = page.getByRole("button", { name: "Update exam details" });
  await expect(button).toHaveAttribute("data-variant", "secondary");
  await button.click();
  const panel = page.getByRole("dialog", { name: "Update exam details" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Already filled in with your current exam. Change anything that’s new.")).toBeVisible();
  // the same fields as the setup form, already filled in
  await expect(panel.getByLabel("Title")).toHaveValue("Final exam");
  await expect(panel.getByLabel("Date")).toHaveValue("December 14");
  await expect(panel.getByLabel("Length, in minutes")).toHaveValue("120");
  await expect(panel.getByLabel("Instructions for Part II")).toHaveValue("One essay, choice of two questions.");
  await expect(panel.getByRole("button", { name: "Add an updated sheet" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Confirm changes" })).toBeDisabled(); // nothing differs yet

  // a note of what the student heard: Margin reads it and proposes the change in the fields
  await panel.getByLabel("A note of what you heard").fill("Prof said Part II will have three essay choices");
  await panel.getByRole("button", { name: "Read my note" }).click();
  await expect(panel.getByLabel("Instructions for Part II")).toHaveValue("One essay, choice of three questions.");
  const changes = panel.getByRole("region", { name: "What changes" });
  await expect(changes.locator("li")).toHaveText(["Part II: choice of two questions → choice of three questions"]);
  await expect(changes.locator("del")).toHaveText("choice of two questions");
  await expect(changes.locator("ins")).toHaveText("choice of three questions");
  await expect(changes.locator("ins")).toHaveCSS("color", "rgb(125, 44, 146)"); // plum
  await expect(changes.getByText("Your past attempts stay, labelled “old format”. New practice exams use the new format.")).toBeVisible();
  // a change made by hand shows up too
  await panel.getByLabel("Date").fill("December 16");
  await expect(changes.locator("li")).toHaveCount(2);
  await panel.getByLabel("Date").fill("December 14");
  await expect(changes.locator("li")).toHaveCount(1);

  // nothing is saved until Confirm changes
  expect(dbAll<{ version: number }>("select version from exams where id = ?", examId)[0].version).toBe(1);
  await panel.getByRole("button", { name: "Confirm changes" }).click();
  await expect(panel).toBeHidden();

  // a new version; the old attempt says old format; the next practice set is written in the new format
  expect(dbAll<{ version: number }>("select version from exams where id = ?", examId)[0].version).toBe(2);
  expect(dbAll<{ number: number }>("select number from exam_versions where exam_id = ? order by number", examId).map((r) => r.number)).toEqual([1, 2]);
  await expect(page.getByRole("button", { name: "Enter the room" })).toBeVisible({ timeout: 15000 });
  await expect(attempts.locator("li")).toHaveCount(1);
  await expect(attempts.locator("li").first().getByText("old format")).toBeVisible();
  const sets = dbAll<{ version: number }>("select version from exam_sets where exam_id = ? order by number", examId);
  expect(sets.map((s) => s.version)).toEqual([1, 2]);
});

test("Cancel keeps everything as it was", async ({ page }) => {
  await page.goto(`/p/${id}/exam?e=${examId}`);
  await page.getByRole("button", { name: "Update exam details" }).click();
  const panel = page.getByRole("dialog", { name: "Update exam details" });
  await panel.getByLabel("Title").fill("Final exam, changed");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel).toBeHidden();
  expect(dbAll<{ version: number; title: string }>("select version, title from exams where id = ?", examId)[0]).toEqual({ version: 2, title: "Final exam" });
});
