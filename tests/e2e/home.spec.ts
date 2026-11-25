import { expect, test } from "@playwright/test";
import path from "node:path";
import { makeProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

test("home: projects show the week they are in and their progress, a tile opens its overview, and the demo is offered", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Margin." })).toBeVisible();
  await page.waitForTimeout(2200); // let the entrance settle
  const tile = page.locator(`.ho-tile[data-project-id="${id}"]`);
  await tile.scrollIntoViewIfNeeded();
  await expect(tile.getByText(/^Week 3 of 3 · 0\/\d+ layers saved$/)).toBeVisible(); // no syllabus dates: the latest week with material
  await expect(tile.getByRole("img", { name: /^0 of \d+ layers saved$/ })).toBeVisible();
  await expect(tile).toContainText("Continue:");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-home-1440.png") });

  await tile.getByRole("button", { name: /^POL101 Federalist Seminar$/ }).click(); // the project's own button, not its "More actions for ..." menu
  await page.waitForURL(new RegExp(`/p/${id}$`), { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("POL101 Federalist Seminar");
  expect(errors).toEqual([]);
});

test("the demo course opens, is already written, and is read-only", async ({ page, request }) => {
  await page.goto("/");
  await page.waitForTimeout(1500);
  const offer = page.getByRole("button", { name: "Open the demo course" });
  if (await offer.count()) {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-home-demo-offer-1440.png") });
    await offer.click();
    await page.waitForURL(/\/p\/[^/]+$/, { timeout: 15_000 });
  } else {
    // other specs make projects with a similar name, so pick the demo's own tile
    const demo = (await (await request.post("/api/demo")).json()) as { id: string };
    await page.locator(`[data-project-id="${demo.id}"]`).getByRole("button", { name: /The Federalist Papers/ }).first().click();
    await page.waitForURL(/\/p\/[^/]+$/, { timeout: 15_000 });
  }
  const id = page.url().match(/\/p\/([^/]+)$/)![1];
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The Federalist Papers");

  // its layers are already written: opening one needs no waiting
  await page.getByRole("banner").getByRole("button", { name: /Start with the first layer|Continue/ }).click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 5000 });
  // the demo is shared with other specs that write to it, so start from its first layer, not from wherever Continue points
  await page.getByRole("navigation", { name: "Layers" }).getByRole("link").first().click();
  await expect(page.getByRole("tab", { name: "Explained", selected: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("Writing this layer")).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-demo-workspace-1440.png") });

  // each tab keeps its own scroll position: find a layer long enough to scroll (real text is long), scroll both tabs, switch back and forth
  const scroller = page.locator(".m-scroll:visible"); // a layer opened earlier can stay mounted but hidden
  for (let i = 0; i < 6 && (await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)) < 700; i++) {
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("]");
    await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 15_000 });
  }
  expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(700);
  await page.waitForLoadState("networkidle");
  await scroller.evaluate((el) => (el.scrollTop = 500));
  await page.waitForTimeout(150);
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.getByRole("tab", { name: "Source", selected: true })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(50); // Source starts at the top
  await scroller.evaluate((el) => (el.scrollTop = 300));
  await page.waitForTimeout(150);
  await page.getByRole("tab", { name: "Explained" }).click();
  await page.waitForTimeout(500);
  expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - 500)).toBeLessThan(6);
  await page.getByRole("tab", { name: "Source" }).click();
  await page.waitForTimeout(500);
  expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - 300)).toBeLessThan(6);
  await page.getByRole("tab", { name: "Explained" }).click(); // leave it on Explained

  // read-only: the plan page redirects away, and the API refuses changes with 403
  await page.goto(`/p/${id}/setup`);
  await page.waitForURL(new RegExp(`/p/${id}$`));
  const layerId = "any-layer";
  for (const [method, url, data] of [
    ["PATCH", `/api/projects/${id}/structure`, { op: "merge", layerId }],
    ["POST", `/api/projects/${id}/structure/approve`, { part: "A" }],
    ["POST", `/api/projects/${id}/structure/propose`, undefined],
    ["POST", `/api/projects/${id}/analyze`, undefined],
    ["POST", `/api/projects/${id}/finish`, undefined],
  ] as const) {
    const r = await request.fetch(url, { method, data });
    expect(r.status(), `${method} ${url}`).toBe(403);
  }
});
