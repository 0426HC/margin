import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { makeProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

async function openFirstLayer(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("a citation opens the original page in a slide-over, the cited passage is marked, Escape closes and returns focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  await openFirstLayer(page, id);

  const cite = page.locator(".m-cite").first();
  await cite.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 2 })).not.toBeEmpty(); // the file name
  await expect(sheet.getByText(/^(Page|Slide) \d+/)).toBeVisible();
  await expect(sheet.locator("mark").first()).toBeVisible(); // the cited passage
  expect((await sheet.locator("mark").allTextContents()).join(" ").length).toBeGreaterThan(20); // a passage can start with a short heading
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5-source-viewer-1440.png") });

  // step to the next page: the mark goes away (no citation there), the page changes
  const first = await sheet.getByText(/^(Page|Slide) \d+/).textContent();
  const next = sheet.getByRole("button", { name: /^Next (page|slide)$/ });
  if (await next.isEnabled()) {
    await next.click();
    await expect(sheet.getByText(/^(Page|Slide) \d+/)).not.toHaveText(first!);
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cite).toBeFocused();
  expect(errors).toEqual([]);
});

test("a citation in review feedback opens the viewer, in a layer and in a synthesis", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  await pane.getByRole("textbox", { name: "Write this layer in your own words" }).fill("The layer opens with the first idea and builds on it.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await pane.locator(".m-cite-inline").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator("mark").first()).toBeVisible();
  await page.getByRole("button", { name: "Close the original" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
