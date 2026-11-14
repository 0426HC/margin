import { expect, test } from "@playwright/test";
import path from "node:path";
import { courseFolder, makeProject } from "./helpers";

// The arrival screens (New project, Note to Self) in their empty and filled states. With SHOTS=1 they are also photographed.
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
const shot = (page: import("@playwright/test").Page, name: string, fullPage = false) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name), fullPage }) : Promise.resolve(undefined));

test("New project: the Librarian takes the files and the copy follows the layer flow", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (SHOTS) await page.route("**/api/projects/*/files", async (route) => (await new Promise((r) => setTimeout(r, 900)), route.continue()));

  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
  await expect(page.getByText("Margin reads the files, then proposes Part A and Part B")).toBeVisible();
  await expect(page.getByText("cuts each file into sections")).toHaveCount(0);
  await expect(page.getByText("Drop a course folder and I will take the files")).toBeVisible();
  await page.waitForTimeout(2200); // let the headline and ink settle before photographing
  await shot(page, "design-new-empty-1440.png");

  await page.getByTestId("folder-input").setInputFiles(courseFolder());
  await expect(page.getByText(/Reading /).first()).toBeVisible();
  await page.waitForTimeout(2200);
  await shot(page, "design-new-reading-1440.png");

  await expect(page.getByRole("status")).toHaveText("6 of 6 read", { timeout: 40_000 });
  await expect(page.getByText(/All 6 are read/)).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "design-new-done-1440.png", true);
  expect(errors).toEqual([]);
});

test("Part overview ends with two cards: Note to Self with its progress, and a clear button to start", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");
    const ends = page.locator(".ov-ends");
    await ends.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800);
    await ends.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await expect(ends.getByRole("button", { name: /Note to Self/ })).toContainText(/0\/\d+ layers saved/);
    await expect(ends.getByRole("button", { name: "Start with the first layer" })).toBeVisible();
    await shot(page, `design-overview-ends-${w}.png`);
  }
  await page.locator(".ov-ends").getByRole("button", { name: /Note to Self/ }).click();
  await page.waitForURL(/\/notes$/);
  expect(errors).toEqual([]);
});
