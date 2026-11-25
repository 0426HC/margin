import { expect, test } from "@playwright/test";
import path from "node:path";
import { makeProject } from "./helpers";

const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;

test("the overview: every Part is a scene with its layers, the rail tracks it, and a sheet zooms into the workspace", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const id = await makeProject(page);
  await page.goto(`/p/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("POL101 Federalist Seminar");
  await expect(page.locator(".ov-w").first()).toHaveCSS("opacity", "1", { timeout: 5000 });
  await page.waitForTimeout(1600); // let the headline settle
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "phase4-overview-intro-1440.png") });

  const scenes = page.locator("section.ov-scene");
  await expect(scenes).toHaveCount(3);
  // the rail covers what is inside the Layers tab: the opening and one tick per week
  await expect(page.locator(".ov-rail .ov-tick")).toHaveText(["Start", "Week 1", "Week 2", "Week 3"]);

  for (let i = 0; i < 3; i++) {
    const scene = scenes.nth(i);
    await expect(scene.getByRole("heading", { level: 2 })).toHaveText(new RegExp(`^Week ${i + 1} · `)); // "Week 1 · Why a new government? …": each week has its syllabus title
    await expect(scene.locator(".ov-kicker").first()).toHaveText(`Week ${i + 1} of 3`);
    // scroll to the point where the labels have appeared
    await scene.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + (el as HTMLElement).offsetHeight - window.innerHeight));
    await page.waitForTimeout(1500);
    const labels = scene.locator(".ov-label");
    const n = await labels.count();
    expect(n).toBeGreaterThan(0);
    for (let k = 0; k < n; k++) await expect(labels.nth(k)).toHaveCSS("opacity", "1");
    await expect(scene.locator(".ov-ink p")).toContainText(/\blayers?\b/);
    await expect(scene.locator(".ov-bar")).toHaveAttribute("aria-label", /not saved/);
    await expect(page.locator(".ov-rail .ov-tick").nth(i + 1)).toHaveAttribute("aria-current", "step");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `phase4-overview-week-${i + 1}-1440.png`) });
  }

  // a layer label opens its layer: the sheet zooms into the reading pane
  const label = scenes.nth(1).locator(".ov-label").first();
  const title = (await label.locator(".ov-label-text").innerText()).trim();
  await label.click();
  await expect(page.locator(".ov-zoom")).toBeAttached();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 30_000 });

  // back to the overview returns to the same scene
  await page.getByRole("link", { name: /^Back to / }).click();
  await page.waitForURL(new RegExp(`/p/${id}\\?tab=layers$`));
  await expect(scenes.nth(1)).toBeInViewport({ timeout: 5000 });
  await expect(page.locator(".ov-zoom")).toHaveCount(0); // the earlier zoom does not replay

  // a second zoom opens the new layer, not the one before
  const first = scenes.nth(0);
  await first.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + (el as HTMLElement).offsetHeight - window.innerHeight));
  await page.waitForTimeout(1500);
  const other = first.locator(".ov-label").first();
  const otherTitle = (await other.locator(".ov-label-text").innerText()).trim();
  expect(otherTitle).not.toBe(title);
  await other.click();
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(otherTitle, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("with reduced motion the overview is a plain page: no Lenis, nothing pinned, and a layer opens directly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await makeProject(page);
  await page.goto(`/p/${id}`);
  await expect(page.locator("section.ov-flat")).toHaveCount(3);
  await expect(page.locator("section.ov-scene")).toHaveCount(0);
  await expect(page.locator("html.lenis")).toHaveCount(0);
  await expect(page.locator(".ov-rail")).toHaveCount(0);
  const flat = page.locator("section.ov-flat").first();
  await expect(flat.getByRole("heading", { level: 2 })).toHaveText(/^Week 1 · Why a new government\?/); // the syllabus names the week
  await flat.getByRole("button").first().click();
  await expect(page.locator(".ov-zoom")).toHaveCount(0);
  await page.waitForURL(/\/l\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
});
