import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

function courseFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, root, { recursive: true });
  return root;
}

test("import the sample course, edit the plan, Looks good, and open a layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(courseFolder());
  await expect(page.getByRole("status")).toContainText("read", { timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];

  // the plan is proposed on its own: the syllabus's three weeks, each with its title and its layers
  const sheet = page.locator(".m-paper");
  await expect(sheet.getByRole("region", { name: "Week 1 · Why a new government? Federalist No. 1" })).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole("region", { name: "Week 2 · Faction and the large republic" })).toBeVisible();
  const week2 = sheet.getByRole("region", { name: /^Week 2 · / });
  const week3 = sheet.getByRole("region", { name: /^Week 3 · / });
  const count3 = await week3.locator(".m-layer").count();
  expect(await week2.locator(".m-layer").count()).toBe(2); // Federalist 10 alone, but long enough that a week needs two layers
  expect(count3).toBe(2); // the slides and Federalist 51
  await expect(sheet.getByText(/Consider splitting it|Four to eight/)).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase3b-plan-1440.png"), fullPage: true });

  // no content may be written before approval
  const firstId = (await sheet.locator(".m-layer").first().getAttribute("data-layer-id"))!;
  const early = await page.request.post(`/api/layers/${firstId}/write`);
  expect(early.status()).toBe(409);

  // rename, merge, move to another week and back
  const title = page.getByRole("textbox", { name: "Title of layer 3.1" });
  await title.fill("Ambition against ambition");
  await title.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title of layer 3.1" })).toHaveValue("Ambition against ambition");
  const question = page.getByRole("textbox", { name: "Big question of layer 3.1" });
  await question.fill("Why must ambition counteract ambition?");
  await question.blur();
  await expect(page.getByRole("textbox", { name: "Big question of layer 3.1" })).toHaveValue("Why must ambition counteract ambition?");

  await page.getByRole("button", { name: /^Merge Ambition against ambition with the next layer$/ }).click();
  await expect(week3.locator(".m-layer")).toHaveCount(count3 - 1);

  // week 2's two layers merge into one, which moves into week 3: week 2 then says its material isn't there, and "Move to week…" brings it back
  await week2.getByRole("button", { name: /^Merge .* with the next layer$/ }).first().click();
  await expect(week2.locator(".m-layer")).toHaveCount(1);
  const moved = (await week2.locator(".m-layer").getAttribute("data-layer-id"))!;
  await page.getByRole("button", { name: /^Move to week 3:/ }).click();
  await expect(week3.locator(".m-layer")).toHaveCount(count3);
  await expect(week2.getByText("Material not added yet")).toBeVisible();
  await page.locator(`.m-layer[data-layer-id="${moved}"]`).getByLabel(/Move .* to another week/).selectOption({ label: "Week 2 · Faction and the large republic" });
  await expect(week2.locator(".m-layer")).toHaveCount(1);
  await expect(week3.locator(".m-layer")).toHaveCount(count3 - 1);

  // Looks good approves the whole plan and opens the course
  await page.getByRole("button", { name: "Looks good" }).first().click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("POL101 Federalist Seminar");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-overview-intro-1440.png") });

  // the Continue button zooms into the first layer, which is written on first open
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The big question")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-workspace-explained-1440.png") });

  // a citation in the margin of Explained opens the original page in the slide-over
  await page.locator(".m-cite").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // the Source tab is remembered for this layer, and the second open is cached (no "writing" state)
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByRole("tab", { name: "Source", selected: true })).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, "phase4-workspace-source-1440.png") });
  }
  await page.waitForResponse((r) => r.url().includes("/view") && r.request().method() === "PUT").catch(() => undefined);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Source", selected: true })).toBeVisible();
  await expect(page.getByText("Writing this layer")).toHaveCount(0);
  expect(errors).toEqual([]);
});
