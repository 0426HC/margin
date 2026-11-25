import { expect, test } from "@playwright/test";
import path from "node:path";
import { makeProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

/** The page is server-rendered first: wait until it has hydrated, or a key press can be lost before its handler is attached. */
async function ready(page: import("@playwright/test").Page) {
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

async function openFirstLayer(page: import("@playwright/test").Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await ready(page);
}

test("the workspace: layers by week, Explained and Source, keyboard moves, the command bar, and nothing is locked", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  await openFirstLayer(page, id);

  // the list is grouped by week, each week collapses (the one being read starts open), and every layer is a link: nothing is locked
  const list = page.getByRole("navigation", { name: "Layers" });
  for (const w of [1, 2, 3]) await expect(list.getByRole("button", { name: new RegExp(`^Week ${w} · `) })).toBeVisible();
  await expect(list.getByRole("button", { name: /^Week 1 · / })).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("button", { name: /^Week 3 · / })).toHaveAttribute("aria-expanded", "false");
  const links = list.locator('a[href*="/l/"]'); // the layers; each week also ends with its optional synthesis
  await expect(list.getByRole("link", { name: /^Week synthesis for week 1/ })).toBeVisible();
  await expect(list.locator(".m-sec-wk").filter({ hasText: /^wk / })).toHaveCount(0); // no per-layer week labels inside a week
  const inWeek1 = await links.count();
  await list.getByRole("button", { name: /^Week 3 · / }).click();
  await expect(list.getByRole("link", { name: /^Week synthesis for week 3/ })).toBeVisible();
  const count = await links.count();
  expect(count).toBeGreaterThan(inWeek1);
  await list.getByRole("button", { name: /^Week 1 · / }).click();
  await expect(links).toHaveCount(count - inWeek1); // week 1's layers folded away
  await list.getByRole("button", { name: /^Week 1 · / }).click();
  await expect(links).toHaveCount(count);

  // jump straight into week 3, before finishing week 1
  const first = page.url();
  await links.nth(count - 1).click();
  await page.waitForURL((u) => u.toString() !== first);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Week 3 · /).first()).toBeVisible();

  // ] and [ walk between layers across the weeks; K and J do the same
  const lastUrl = page.url();
  await ready(page);
  await page.keyboard.press("[");
  await page.waitForURL((u) => u.toString() !== lastUrl);
  const prevUrl = page.url();
  await ready(page);
  await page.keyboard.press("]");
  await page.waitForURL(lastUrl);
  await ready(page);
  await page.keyboard.press("k");
  await page.waitForURL(prevUrl);
  await ready(page);
  await page.keyboard.press("j");
  await page.waitForURL(lastUrl);
  expect(errors).toEqual([]);
});

test("Explained and Source: the choice is per layer, scroll is kept per view", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  await expect(page.getByText("The big question")).toBeVisible();
  // the citations sit in the margin, not in the text
  await expect(page.locator(".m-explained p, .m-row > p").filter({ hasText: /\[.*, p\. \d+\]/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByRole("tab", { name: "Source", selected: true })).toBeVisible();
  await expect(page.locator(".m-page-marker").first()).toContainText("p. ");
  await expect(page.locator(".m-page-file").first()).not.toBeEmpty(); // the file name sits beside the page

  // Source keeps the original's shape: more than one paragraph in a quote, as separate elements
  expect(await page.locator(".m-q > p").count()).toBeGreaterThan(1);
  await expect(page.locator(".m-q > .m-q-head").first()).toBeVisible(); // headings stay headings

  // the other layers still default to Explained (keys are ignored while a tab has focus, so let go of it first)
  await page.getByRole("tab", { name: "Source" }).blur();
  await page.keyboard.press("]");
  await expect(page.getByRole("tab", { name: "Explained", selected: true })).toBeVisible({ timeout: 30_000 });
  await ready(page);
  await page.keyboard.press("[");
  await expect(page.getByRole("tab", { name: "Source", selected: true })).toBeVisible();
});

test("the command bar jumps to a layer or searches the files, and Escape closes it", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  await page.keyboard.press("Meta+k");
  const bar = page.getByRole("dialog", { name: "Command bar" });
  await expect(bar).toBeVisible();
  await bar.getByRole("combobox").fill("lecture 3 slides"); // a layer in week 3, which the sidebar keeps folded
  const option = bar.getByRole("option").filter({ hasText: "Lecture 3 slides" }).first();
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lecture 3 slides", { timeout: 30_000 });

  await page.keyboard.press("Control+k");
  await expect(bar).toBeVisible();
  await bar.getByRole("combobox").fill("federalist");
  await expect(bar.getByText("In your files")).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("panes: collapse the list, resize with the keyboard, and at 1024 the list starts collapsed", async ({ page }) => {
  const id = await makeProject(page);
  await openFirstLayer(page, id);
  await expect(page.locator(".m-left")).not.toHaveAttribute("data-collapsed", "");
  await page.getByRole("button", { name: "Hide the layer list" }).click();
  await expect(page.locator(".m-left")).toHaveAttribute("data-collapsed", "");
  await page.getByRole("button", { name: "Show the layer list" }).click();
  const handle = page.getByRole("separator", { name: "Resize the layer list" });
  const before = await page.locator(".m-left").evaluate((el) => el.getBoundingClientRect().width);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.locator(".m-left").evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(before);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-workspace-1440.png") });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".m-left")).toHaveAttribute("data-collapsed", "");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-workspace-1024.png") });
});

test("nothing is locked: the last week can be opened and written before the first is touched", async ({ page }) => {
  const id = await makeProject(page);
  await page.goto(`/p/${id}`);
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  const nav = page.getByRole("navigation", { name: "Layers" });
  await nav.getByRole("button", { name: /^Week 3 · / }).click();
  await nav.locator('a[href*="/l/"]').last().click();
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Week 3 · .*, layer \d+ of \d+/)).toBeVisible();
});
