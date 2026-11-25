import { expect, test } from "@playwright/test";
import path from "node:path";
import { makeProject, writeUps } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

test("week synthesis: optional, last under its week in the layer list, same loop ending in a save question, and filed in Note to Self", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);

  // reach it from a layer's list: every week ends with its optional synthesis, never locked
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  const nav = page.getByRole("navigation", { name: "Layers" });
  const synth1 = nav.getByRole("link", { name: /^Week synthesis for week 1/ });
  await expect(synth1).toContainText("optional");
  await expect(synth1).toHaveAccessibleName(/not saved$/);
  await synth1.click();
  await page.waitForURL(/\/week\/1\/synthesis$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tie week 1 together" })).toBeVisible();
  await expect(page.getByText(/^Week 1 · .* · optional$/)).toBeVisible();
  await expect(page.getByText(/None of this week’s layers is saved yet\. You can write the synthesis now/)).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Week synthesis for week 1/ })).toHaveAttribute("aria-current", "true");
  await page.waitForLoadState("networkidle");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5b-synthesis-empty-1440.png") });

  const pane = page.getByRole("complementary", { name: "Write the synthesis" });
  const box = pane.getByRole("textbox", { name: "Tie this week together in your own words" });
  await box.fill("Week one builds one argument: each layer adds a step to the case for the Union.");
  await pane.getByRole("button", { name: "Submit" }).click();
  await expect(pane.getByText("Not yet")).toBeVisible({ timeout: 15_000 });
  await expect(pane.getByText("Your synthesis").first()).toBeVisible();
  await expect(pane.getByRole("heading", { name: "Fixes" })).toBeVisible();
  await expect(pane.getByRole("heading", { name: "So what" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^Week synthesis for week 1/ })).toHaveAccessibleName(/not saved$/);

  await box.fill("Week one builds one argument, step by step: each layer adds to the case for the Union.");
  await pane.getByRole("button", { name: "Submit" }).click();
  const asks = pane.getByRole("region", { name: "Send to Note to Self?" });
  await expect(asks).toHaveCount(2, { timeout: 15_000 });
  await asks.last().getByRole("button", { name: "Yes, my own writing" }).click();
  await expect(nav.getByRole("link", { name: /^Week synthesis for week 1/ })).toContainText("saved");
  await expect(nav.getByRole("link", { name: /^Week synthesis for week 1/ })).not.toHaveAccessibleName(/not saved$/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "v2-synthesis-saved-1440.png") });

  // week 3: the refined version (week 3's group opens when its header is clicked)
  await nav.getByRole("button", { name: /^Week 3 · / }).click();
  await nav.getByRole("link", { name: /^Week synthesis for week 3/ }).click();
  await page.waitForURL(/\/week\/3\/synthesis$/);
  const paneB = page.getByRole("complementary", { name: "Write the synthesis" });
  await paneB.getByRole("textbox", { name: "Tie this week together in your own words" }).fill("Week three in one go: power is split so ambition checks ambition.");
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
    expect.objectContaining({ value: expect.stringContaining("Week one builds one argument, step by step"), label: expect.stringMatching(/Week 1 · .* synthesis/) }),
    expect.objectContaining({ value: expect.stringContaining("ambition checks ambition"), label: expect.stringMatching(/Week 3 · .* synthesis/) }),
  ]);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase5b-notes-synthesis-1440.png") });
  expect(errors).toEqual([]);
});
