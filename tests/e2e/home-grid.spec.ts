import { expect, test } from "@playwright/test";
import path from "node:path";
import { seedProject } from "./helpers";

// Every project card is the same size and the grid reflows as projects are added. Seeded through the API with the fake
// engine into the e2e temp data folder. Exact counts hold when this file runs on its own (a fresh data folder).
const SHOTS = process.env.SHOTS ? path.join("docs", "screens") : null;
const COURSES = ["POL101 The Federalist Papers", "GOV240 Comparative government", "HIS210 Europe after 1945", "PHI120 Ethics and the good life", "ECO200 Intermediate macroeconomics", "SOC150 Cities and inequality", "LIT230 The modern novel", "HIS340 Empires and their ends", "POL410 Theories of justice"];

test("home grid: equal cards at 1, 2, 5 and 9 projects, with New project in the next slot", async ({ page, request }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let made = 0;
  for (const target of [1, 2, 5, 9]) {
    while (made < target) await seedProject(request, COURSES[made++]);
    for (const [w, h] of [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/");
      await page.waitForTimeout(1500);
      const grid = page.locator(".ho-grid");
      await grid.scrollIntoViewIfNeeded();
      const cards = grid.locator(":scope > .ho-tile");
      const projects = grid.locator(".ho-tile[data-project-id]");
      expect(await projects.count()).toBeGreaterThanOrEqual(target);
      // all cards, the New project card included, share one size
      const boxes = await cards.evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]));
      expect(new Set(boxes.map((b) => b.join("x"))).size, `card sizes at ${target} projects, ${w}px: ${JSON.stringify(boxes)}`).toBe(1);
      // New project is the last card
      await expect(cards.last()).toContainText("New project");
      // the continue line sits inside each card
      expect(await projects.filter({ hasText: "Continue:" }).count()).toBeGreaterThanOrEqual(target);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.waitForTimeout(400);
      if (SHOTS) await page.locator(".ho-projects").screenshot({ path: path.join(SHOTS, `design-home-grid-${target}-${w}.png`) });
    }
  }
  expect(errors).toEqual([]);
});
