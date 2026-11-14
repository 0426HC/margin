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

test("import the sample course, plan the layers, approve them, and open a layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(courseFolder());
  await expect(page.getByRole("status")).toContainText("read", { timeout: 30_000 });
  await page.getByRole("button", { name: "Review units" }).click();
  await page.waitForURL(/\/p\/[^/]+\/import$/);
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];
  await page.getByRole("button", { name: "Plan the layers" }).first().click();
  await page.waitForURL(/\/setup$/);

  // nothing is proposed until asked
  await page.getByRole("button", { name: "Suggest the layers" }).click();
  const sheet = page.locator(".m-paper");
  await expect(sheet.getByRole("region", { name: "Part A" })).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole("region", { name: "Part B" })).toBeVisible();
  const partA = sheet.getByRole("region", { name: "Part A" });
  const partB = sheet.getByRole("region", { name: "Part B" });
  const countA = await partA.locator(".m-layer").count();
  const countB = await partB.locator(".m-layer").count();
  expect(countA).toBeGreaterThan(0);
  expect(countB).toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase3b-plan-1440.png"), fullPage: true });

  // no content may be written before approval
  const firstId = (await partA.locator(".m-layer").first().getAttribute("data-layer-id"))!;
  const early = await page.request.post(`/api/layers/${firstId}/write`);
  expect(early.status()).toBe(409);

  // rename, merge, move across the boundary
  const title = page.getByRole("textbox", { name: "Title of layer A1" });
  await title.fill("What a faction is");
  await title.press("Enter");
  await expect(page.getByRole("textbox", { name: "Title of layer A1" })).toHaveValue("What a faction is");
  const question = page.getByRole("textbox", { name: "Big question of layer A1" });
  await question.fill("Why does Madison fear faction?");
  await question.blur();
  await expect(page.getByRole("textbox", { name: "Big question of layer A1" })).toHaveValue("Why does Madison fear faction?");

  await page.getByRole("button", { name: /^Merge What a faction is with the next layer$/ }).click();
  await expect(partA.locator(".m-layer")).toHaveCount(countA - 1);

  await page.getByRole("button", { name: /^Move to Part B:/ }).click();
  await expect(partA.locator(".m-layer")).toHaveCount(countA - 2);
  await expect(partB.locator(".m-layer")).toHaveCount(countB + 1);
  await page.getByRole("button", { name: /^Move to Part A:/ }).first().click();
  await expect(partA.locator(".m-layer")).toHaveCount(countA - 1);

  // approve both Parts, then open the course
  await page.getByRole("button", { name: "Approve the layers of Part A" }).click();
  await expect(partA.getByText("Approved")).toBeVisible();
  await page.getByRole("button", { name: "Approve the layers of Part B" }).click();
  await expect(partB.getByText("Approved")).toBeVisible();
  await page.getByRole("button", { name: "Open the course" }).first().click();
  await page.waitForURL(new RegExp(`/p/${projectId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("POL101 Federalist Seminar");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-overview-intro-1440.png") });

  // the Continue button zooms into the first layer, which is written on first open
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("canned explanation")).toBeVisible();
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
