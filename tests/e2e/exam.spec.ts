import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// The exam room, end to end on the fake engine: add a sheet, check the summary, start screen, the room, hand in, feedback, try again, new questions.
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
test.describe.configure({ mode: "serial" });

const SHEET = "Midterm exam instructions\n\nDate: Oct 21. Time allowed: 90 minutes. Section A: multiple choice. Section B: essay. This exam covers weeks 1 to 3. Marking guide: marks are awarded for use of the readings and for clear argument.";
let id = "";
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Exam Course");
  const page = await browser.newPage();
  await layerIdsOf(page, id);
  await page.close();
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const room = (page: Page) => page.getByRole("dialog", { name: /practice exam$/ });

test("the section is in the side menu and starts as the empty room: a desk, a drop box, three steps and the demo exam", async ({ page }) => {
  const [layer] = await layerIdsOf(page, id);
  await page.goto(`/p/${id}/l/${layer}`);
  await page.getByRole("link", { name: "Exam room" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}/exam$`));
  await expect(page.getByRole("button", { name: "Add exam sheet" })).toBeVisible();
  // never blank: the empty room, with the desk and a blank paper, the hero standing on it (no chair, no student)
  await expect(page.getByRole("img", { name: /empty exam room/ })).toBeVisible();
  await expect(page.locator(".ex-empty-art .art-chair, .ex-empty-art .art-student")).toHaveCount(0);
  await expect(page.locator(".ex-empty-art .art-paper-line, .ex-empty-art .art-paper-writing")).toHaveCount(0);
  await expect(page.locator(".ex-empty-art .hero")).toHaveCount(1);
  await expect(page.locator(".ex-empty-art .hero-pencil")).toHaveCount(0);
  await expect(page.getByText("Drop your exam sheet here")).toBeVisible();
  await expect(page.getByText("The instructions your professor gave you: PDF or Word.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  const steps = page.locator(".ex-steps li");
  await expect(steps).toHaveText(["Margin reads the format, time and sections.", "It writes practice questions from your course.", "You answer, and get feedback against the marking guide."]);
  await expect(page.getByRole("button", { name: "Or try the demo exam" })).toBeVisible();
  // the drop box takes a file dropped on it
  const drop = page.locator(".ex-drop");
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await drop.dispatchEvent("dragover", { dataTransfer: dt });
  await expect(drop).toHaveAttribute("data-over", "");
  await drop.dispatchEvent("dragleave", { dataTransfer: dt });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-empty-1440.png") });
});

test("a sheet is read into a summary to check and edit; nothing is generated before 'This looks right'", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/p/${id}/exam`);
  await page.getByTestId("exam-sheet-input").setInputFiles({ name: "Midterm exam instructions.txt", mimeType: "text/plain", buffer: Buffer.from(SHEET) });
  const form = page.getByRole("form", { name: "Summary of the exam sheet" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form.getByLabel("Length, in minutes")).toHaveValue("90");
  await expect(form.getByLabel("Date")).toHaveValue("Oct 21");
  await expect(form.getByLabel("Question type of Section A")).toHaveValue("multiple_choice");
  await expect(form.getByLabel("Question type of Section B")).toHaveValue("essay");
  await expect(form.getByLabel("Marking guide")).toHaveValue(/marks are awarded for use of the readings/);
  for (const w of [1, 2, 3]) await expect(form.getByRole("checkbox", { name: `Week ${w}` })).toBeChecked();
  expect(dbCount("select count(*) from exams where project_id = ?", id)).toBe(1);
  expect(dbCount("select count(*) from exam_sets where exam_id in (select id from exams where project_id = ?)", id)).toBe(0); // nothing is written before the student says it looks right
  // a past exam can be attached
  await form.getByTestId("exam-material-input").setInputFiles({ name: "Past midterm 2024.txt", mimeType: "text/plain", buffer: Buffer.from("Past exam. Q1 Explain why Madison fears faction.") });
  await expect(page.getByRole("form", { name: "Summary of the exam sheet" }).getByText("Past midterm 2024.txt")).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-summary-1440.png") });
  // the student corrects the length and confirms
  await page.getByRole("form", { name: "Summary of the exam sheet" }).getByLabel("Length, in minutes").fill("60");
  await page.getByRole("button", { name: "This looks right" }).click();
  await expect(page.getByRole("heading", { name: "The exam room", level: 2 })).toBeVisible({ timeout: 30_000 });
  expect(dbAll<{ summary: string; confirmed: number }>("select summary, confirmed from exams where project_id = ? order by created_at", id)[0]).toMatchObject({ confirmed: 1 });
  expect(JSON.parse(dbAll<{ summary: string }>("select summary from exams where project_id = ? order by created_at", id)[0].summary).lengthMinutes).toBe(60);
  expect(errors).toEqual([]);
});

test("the start screen has the label and ONE choice, then Enter the room", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  await expect(page.getByRole("heading", { name: "The exam room", level: 2 })).toBeVisible();
  await expect(page.getByText("Practice in your exam’s format, built from your course. These are not predicted questions.")).toBeVisible();
  const choice = page.getByRole("group", { name: "Timer" });
  await expect(choice.getByRole("radio")).toHaveCount(2, { timeout: 45_000 }); // once the practice set has been written
  await expect(choice.getByRole("radio", { name: /Use the real time limit/ })).toBeChecked();
  await expect(choice.getByText(/60 minutes/)).toBeVisible();
  await expect(choice.getByRole("radio", { name: "No timer" })).toBeVisible();
  const enter = page.getByRole("button", { name: "Enter the room" });
  await expect(enter).toBeEnabled({ timeout: 30_000 }); // the set has been written
  expect(dbCount("select count(*) from exam_sets where exam_id in (select id from exams where project_id = ?)", id)).toBe(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-start-1440.png") });
});

test("the room: one question at a time, a progress list, the timer, answers that autosave, and Hand it in", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  await page.getByRole("button", { name: "Enter the room" }).click();
  const r = room(page);
  await expect(r).toBeVisible({ timeout: 15_000 });
  await expect(r.getByRole("timer", { name: "Time left" })).toContainText("left");
  await expect(r.getByRole("navigation", { name: "Questions" }).getByRole("button")).toHaveCount(4); // 3 multiple choice + 1 essay, like the sheet
  await expect(r.getByText(/Question 1 of 4 · Multiple choice · 2 marks/)).toBeVisible();
  await expect(r.locator(".ex-origin")).toContainText(/Built from .*\[[^\]]+, p\. \d+\]/);
  // answer the first question
  await r.getByRole("radio").first().check();
  await expect(r.getByRole("button", { name: /Question 1, answered/ })).toBeVisible();
  await r.getByRole("button", { name: "Next" }).click();
  await expect(r.getByText(/Question 2 of 4/)).toBeVisible();
  await r.getByRole("button", { name: /Question 4/ }).click();
  await expect(r.getByText(/Question 4 of 4 · Essay · 10 marks/)).toBeVisible();
  const essay = "Madison argues that a large republic dilutes faction, because many interests make a lasting majority unlikely. Checks inside the government add a second protection.";
  await r.getByRole("textbox", { name: "Your answer" }).fill(essay);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-room-1440.png") });
  // autosave: after a reload the room comes back with the answers and the timer still running
  await expect.poll(() => dbAll<{ answers: string }>("select answers from exam_attempts where set_id in (select s.id from exam_sets s join exams e on e.id = s.exam_id where e.project_id = ?)", id)[0].answers).toContain("Madison argues");
  await page.reload();
  await expect(room(page)).toBeVisible({ timeout: 15_000 });
  await room(page).getByRole("button", { name: /Question 4/ }).click();
  await expect(room(page).getByRole("textbox", { name: "Your answer" })).toHaveValue(essay);
  await expect(room(page).getByRole("timer", { name: "Time left" })).toBeVisible();

  // hand it in early: two questions are left unanswered
  await room(page).getByRole("button", { name: "Hand it in" }).first().click();
  const confirm = page.getByRole("dialog", { name: "Hand it in?" });
  await expect(confirm).toContainText("You have answered 2 of 4 questions");
  await expect(confirm).toContainText("not marked down");
  await confirm.getByRole("button", { name: "Hand it in" }).click();
  const fb = page.getByRole("region", { name: "Feedback" });
  await expect(fb).toBeVisible({ timeout: 30_000 });
  await expect(room(page)).toHaveCount(0);
  await expect(fb.getByText(/\d+(\.5)? of 16 marks/)).toBeVisible();
  await expect(fb.getByText("marked by code").first()).toBeVisible();
  await expect(fb.getByText("marked by the Examiner")).toBeVisible();
  await expect(fb.getByText(/skipped, 2 marks/).first()).toBeVisible();
  await expect(fb.getByText("You skipped this one. It was not marked down.").first()).toBeVisible();
  await expect(fb.getByRole("list", { name: "What to fix" }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-feedback-1440.png") });
});

test("Try again keeps the same questions (no timer this time); New questions writes a fresh set in the same format", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  const before = dbAll<{ id: string; questions: string }>("select id, questions from exam_sets where exam_id in (select id from exams where project_id = ?) order by number", id);
  expect(before).toHaveLength(1);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "The exam room", level: 2 })).toBeVisible();
  await page.getByRole("radio", { name: "No timer" }).check();
  await page.getByRole("button", { name: "Enter the room" }).click();
  await expect(room(page)).toBeVisible({ timeout: 15_000 });
  await expect(room(page).getByRole("timer")).toHaveCount(0);
  expect(dbCount("select count(*) from exam_sets where exam_id in (select id from exams where project_id = ?)", id)).toBe(1); // same questions
  expect(dbCount("select count(*) from exam_attempts where set_id in (select s.id from exam_sets s join exams e on e.id = s.exam_id where e.project_id = ?)", id)).toBe(2);
  await room(page).getByRole("button", { name: "Hand it in" }).first().click();
  await page.getByRole("dialog", { name: "Hand it in?" }).getByRole("button", { name: "Hand it in" }).click();
  await expect(page.getByRole("region", { name: "Feedback" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/0 of 16 marks/)).toBeVisible(); // nothing answered: everything skipped, nothing marked down beyond zero earned

  await page.getByRole("button", { name: "New questions" }).click();
  await expect(page.getByRole("button", { name: "Enter the room" })).toBeVisible({ timeout: 45_000 });
  const after = dbAll<{ id: string; number: number; questions: string }>("select id, number, questions from exam_sets where exam_id in (select id from exams where project_id = ?) order by number", id);
  expect(after).toHaveLength(2);
  const [a, b] = after.map((s) => (JSON.parse(s.questions) as { prompt: string; format: string }[]));
  expect(b.map((q) => q.format)).toEqual(a.map((q) => q.format)); // the same format
  expect(b.map((q) => q.prompt).filter((p) => a.some((x) => x.prompt === p))).toEqual([]); // nothing repeated
});

test("an exam sheet that arrives through What's new gets its own exam", async ({ request }) => {
  const stage = await request.post(`/api/projects/${id}/updates/stage`, { multipart: { file: { name: "Final exam instructions.txt", mimeType: "text/plain", buffer: Buffer.from("Final exam instructions\n\nTime allowed: 120 minutes. Section A: short answer.") }, relPath: "Final exam instructions.txt", type: "exam" } });
  const row = (await stage.json()) as { id: string };
  expect((await request.post(`/api/projects/${id}/updates/commit`, { data: { staged: [{ fileId: row.id }], removals: [] } })).ok()).toBe(true);
  const exams = dbAll<{ title: string; kind: string }>("select title, kind from exams where project_id = ? order by created_at", id);
  expect(exams.map((e) => e.title)).toEqual(["Midterm exam", "Final"]);
  expect(exams[1].kind).toBe("final");
});

test("the project overview has an exam room tab with its scene in the same layout, between Lecture notes and Note to Self", async ({ page }) => {
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /^Exam room/ }).click();
  const scene = page.getByRole("region", { name: "The exam room" });
  await page.waitForTimeout(1500);
  await expect(scene.locator(".ov-free-status")).toContainText("Midterm exam: last attempt 0 of 16 marks");
  await expect(scene.locator(".ov-free-status")).toContainText("Final");
  // the callouts come from the first exam's sheet
  await expect(scene.locator(".art-callout-text").first()).toContainText("1 hour");
  // a big sheet with six answer lines, and the hero holding the pencil above its head; no student, no chair
  await expect(scene.locator(".art-paper-rule")).toHaveCount(6);
  await expect(scene.locator(".hero .hero-pencil")).toHaveCount(1);
  await expect(scene.locator(".art-student, .art-chair")).toHaveCount(0);
  // the hero is writing: the answer lines fill in over time
  await expect.poll(() => scene.locator(".art-paper-writing").first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a), { timeout: 8000 }).toBeGreaterThan(0.3);
  const text = (await scene.locator(".ov-free-text").boundingBox())!;
  const art = (await scene.locator(".ov-free-art").boundingBox())!;
  expect(art.x).toBeGreaterThan(text.x + text.width - 1);
  await scene.getByRole("link", { name: "Open the exam room" }).click();
  await page.waitForURL(new RegExp(`/p/${id}/exam$`));
});

test("on a phone the exam room says it works best on a computer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${id}/exam`);
  await expect(page.getByRole("note")).toContainText("The exam room works best on a computer");
  await expect(page.getByRole("button", { name: "Enter the room" })).toBeHidden();
});

test("deleting an exam removes its sheet, sets and attempts for good, with a styled confirm", async ({ page }) => {
  await page.goto(`/p/${id}/exam`);
  await page.getByRole("button", { name: "Delete Midterm exam" }).click();
  const d = page.getByRole("dialog", { name: "Delete Midterm exam?" });
  await expect(d).toContainText("cannot be undone");
  await d.getByRole("button", { name: "Delete exam" }).click();
  await expect(page.getByRole("button", { name: "Delete Final" })).toBeVisible({ timeout: 15_000 }); // the Final is what is left
  expect(dbCount("select count(*) from exams where project_id = ? and title like 'Midterm%'", id)).toBe(0);
  expect(dbCount("select count(*) from exam_sets where exam_id in (select id from exams where project_id = ?)", id)).toBe(0);
  expect(dbCount("select count(*) from exam_attempts where set_id in (select s.id from exam_sets s join exams e on e.id = s.exam_id where e.project_id = ?)", id)).toBe(0);
  expect(dbCount("select count(*) from files where project_id = ? and (name like 'Midterm exam instructions%' or name like 'Past midterm%')", id)).toBe(0);
});

test("the demo exam: the demo course offers it, it loads the fictional sheet, and the whole room works on it", async ({ page, request }) => {
  const { id: demo } = (await (await request.post("/api/demo")).json()) as { id: string };
  await page.goto(`/p/${demo}/exam`);
  await expect(page.getByRole("button", { name: "Add exam sheet" })).toHaveCount(0); // the demo stays read-only
  await expect(page.locator(".ex-drop")).toHaveCount(0);
  await page.getByRole("button", { name: "Try the demo exam" }).click();
  const form = page.getByRole("form", { name: "Summary of the exam sheet" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await expect(form.getByLabel("Length, in minutes")).toHaveValue("120");
  await expect(form.getByLabel("Date")).toHaveValue("December 14");
  await expect(form.getByLabel("Question type of Part I", { exact: true })).toHaveValue("short_answer");
  await expect(form.getByLabel("Question type of Part II")).toHaveValue("essay");
  await expect(form.getByLabel("Marking guide")).toHaveValue(/A definition alone earns at most 5/);
  const files = dbAll<{ name: string; role: string }>("select name, role from files where project_id = ? and role = 'exam'", demo);
  expect(files).toEqual([{ name: "POL101 Final exam instructions.md", role: "exam" }]);
  // loading it again does not add a second copy
  expect((await (await request.post("/api/demo/exam")).json()).projectId).toBe(demo);
  expect(dbCount("select count(*) from exams where project_id = ?", demo)).toBe(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "exam-demo-summary-1440.png") });
  await page.getByRole("button", { name: "This looks right" }).click();
  await expect(page.getByRole("heading", { name: "The exam room", level: 2 })).toBeVisible({ timeout: 30_000 });
  const enter = page.getByRole("button", { name: "Enter the room" });
  await expect(enter).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByRole("group", { name: "Timer" }).getByText(/minutes/)).toBeVisible();
  await enter.click();
  await expect(room(page)).toBeVisible({ timeout: 15_000 });
  await room(page).getByRole("button", { name: "Hand it in" }).first().click();
  await page.getByRole("dialog", { name: "Hand it in?" }).getByRole("button", { name: "Hand it in" }).click();
  await expect(page.getByRole("region", { name: "Feedback" })).toBeVisible({ timeout: 30_000 });
});
