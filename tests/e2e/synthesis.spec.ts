import { expect, test } from "@playwright/test";
import path from "node:path";
import { makeProject, writeUps } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

test("Part synthesis: reachable from the layer list, same loop ending in a save question, and its sheet in Note to Self opens it", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);

  // reach it from a layer's list: every Part ends with its synthesis, never locked
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  const nav = page.getByRole("navigation", { name: "Layers" });
  await nav.getByRole("link", { name: "Part A synthesis" }).click();
  await page.waitForURL(/\/part\/A\/synthesis$/);
  await expect(page.getByRole("heading", { level: 1, name: "Part A synthesis" })).toBeVisible();
  await expect(page.getByText(/None of this Part’s layers is saved yet\. You can write the synthesis now/)).toBeVisible();
  await expect(nav.getByRole("link", { name: "Part A synthesis" })).toHaveAttribute("aria-current", "true");
  await page.waitForLoadState("networkidle");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5b-synthesis-empty-1440.png") });

  const pane = page.getByRole("complementary", { name: "Write the synthesis" });
  const box = pane.getByRole("textbox", { name: "Write the synthesis in your own words" });
  await box.fill("Part A builds one argument: each layer adds a step to the case for the Union.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByText("Your synthesis").first()).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Fixes" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "So what" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Part A synthesis" }).getByRole("img", { name: "Not saved" })).toBeVisible();

  await box.fill("Part A builds one argument, step by step: each layer adds to the case for the Union.");
  await pane.getByRole("button", { name: "Submit" }).click();
  const asks = pane.getByRole("region", { name: "Send to Note to Self?" });
  await expect(asks).toHaveCount(2, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "Yes, my own writing" }).click();
  await expect(nav.getByRole("link", { name: "Part A synthesis" }).getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2-synthesis-saved-1440.png") });

  // Part B: the refined version
  await nav.getByRole("link", { name: "Part B synthesis" }).click();
  await page.waitForURL(/\/part\/B\/synthesis$/);
  const paneB = page.getByRole("complementary", { name: "Write the synthesis" });
  await paneB.getByRole("textbox", { name: "Write the synthesis in your own words" }).fill("Part B in one go: power is split so ambition checks ambition.");
  await paneB.getByRole("button", { name: "Submit" }).click();
  await expect(paneB.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await paneB.getByRole("button", { name: "Yes, refined version" }).click();
  await expect(paneB.getByText("In Note to Self: refined version.")).toBeVisible();

  // 1024: the list collapses by default, the panes still fit
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5b-synthesis-1024.png") });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Note to Self: both syntheses are filed, and the sheet opens the synthesis screen
  await page.goto(`/p/${id}/notes`);
  await expect.poll(() => writeUps(page)).toEqual([
    expect.objectContaining({ value: expect.stringContaining("Part A builds one argument, step by step"), label: expect.stringContaining("Part A synthesis") }),
    expect.objectContaining({ value: expect.stringContaining("ambition checks ambition"), label: expect.stringContaining("Part B synthesis") }),
  ]);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5b-notes-synthesis-1440.png") });
  expect(errors).toEqual([]);
});
