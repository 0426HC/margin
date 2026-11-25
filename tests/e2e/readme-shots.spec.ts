import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The README's screenshots, from the demo course only (and its own sample folder for the import screen), in both modes. Not a test: off
 * unless README_SHOTS=1 (or =import for the import screen alone), and run with playwright.readme.config.ts (the real engine, a throwaway data folder). Writes docs/readme/*.jpg.
 */
test.skip(!["1", "import"].includes(process.env.README_SHOTS ?? ""), "README_SHOTS=1 takes the README's screenshots (README_SHOTS=import only the import screen)");
const OUT = path.join("docs", "readme");
const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const MODES = ["normal", "lock-in"] as const;
type Mode = (typeof MODES)[number];

async function inMode(page: Page, mode: Mode) {
  await page.evaluate((m) => localStorage.setItem("margin:mode", m), mode);
}
async function shoot(page: Page, name: string, mode: Mode) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200); // entrances settle
  await page.screenshot({ path: path.join(OUT, `${name}-${mode}.jpg`), type: "jpeg", quality: 85 });
}

test("README screenshots", async ({ page, request }) => {
  await page.goto("/");
  fs.mkdirSync(OUT, { recursive: true });
  if (process.env.README_SHOTS === "1") await demoShots(page, request);
  await importShots(page);
});

async function demoShots(page: Page, request: import("@playwright/test").APIRequestContext) {
  const { id } = (await (await request.post("/api/demo")).json()) as { id: string };
  await page.goto("/");
  await inMode(page, "lock-in");
  await page.goto(`/p/${id}`);
  const first = (await page.locator(".lk-ov a[href*='/l/']").first().getAttribute("href"))!.split("/l/")[1];

  // the real work first, once: a write-back reviewed and saved to Note to Self, and a question in Let's talk!
  await page.goto(`/p/${id}/l/${first}`);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 60_000 });
  const pane = page.getByRole("complementary", { name: "Write this layer back" });
  await pane.getByRole("textbox", { name: "Write this layer in your own words" }).fill(
    "Publius says the debate over the Constitution matters because Americans get to show whether a people can choose good government by reflection and choice, instead of having it fall on them by accident and force. If they choose badly, it is a loss for everyone. He also warns that people on both sides argue from ambition and suspicion, so readers should judge the arguments themselves and not the motives behind them.",
  );
  await pane.getByRole("button", { name: "Submit" }).click();
  await pane.getByRole("region", { name: "Send to Note to Self?" }).last().getByRole("button", { name: "Yes, refined version" }).click({ timeout: 300_000 });
  await page.goto(`/p/${id}?tab=talk`); // in lock in: the real Let's talk! page, to ask from
  const ask = page.getByRole("textbox", { name: /Ask/ }).first();
  await ask.fill("Why does Madison think a large republic controls faction better than a small one?");
  await page.getByRole("button", { name: "Ask" }).first().click();
  const log = page.locator(".m-chat-list").first();
  await expect(log).toHaveAttribute("aria-busy", "true");
  await expect(log).toHaveAttribute("aria-busy", "false", { timeout: 300_000 }); // the answer has finished

  // the demo's exam, read from its sheet
  await page.goto(`/p/${id}/exam`);
  const demoExam = page.getByRole("button", { name: "Try the demo exam" });
  await demoExam.click({ timeout: 30_000 });
  await expect(demoExam).toHaveCount(0, { timeout: 30_000 });

  for (const mode of MODES) {
    await inMode(page, mode);
    await page.goto(`/p/${id}?tab=layers`); // a bare address would reopen the tab used last
    if (mode === "normal") {
      await page.locator(".ov-scene").first().waitFor();
      // the first week's scene, settled: its title, what it covers, its layers as sheets
      await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".ov-scene")!;
        window.scrollTo(0, s.offsetTop + s.offsetHeight - innerHeight);
      });
    }
    await shoot(page, "course", mode);
    await page.goto(`/p/${id}/l/${first}`);
    await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 60_000 });
    await shoot(page, "explained", mode);
    if (mode === "normal") {
      // further down: a section answering its sub-question, each named idea explained where it matters, its pages in the margin
      await page.locator(".m-reading-pane:not([aria-busy]) .m-section:visible").nth(1).evaluate((el) => el.scrollIntoView({ block: "start" }));
      // clear of the sticky tab bar, so the section's heading shows whole
      const bar = await page.locator(".m-reading-pane:not([aria-busy]) .m-bar:visible").evaluate((el) => el.getBoundingClientRect().height);
      await page.locator(".m-reading-pane:not([aria-busy]) .m-scroll:visible").evaluate((el, h) => el.scrollBy(0, -(h + 24)), bar);
      await shoot(page, "explained-section", mode);
    }
    // the real pages (the course page's tabs show their scenes in normal mode)
    await page.goto(`/p/${id}/talk`);
    await shoot(page, "talk", mode);
    await page.goto(`/p/${id}/notes`);
    await shoot(page, "note-to-self", mode);
    await page.goto(`/p/${id}/exam`);
    await shoot(page, "exam", mode);
  }

}

/** The import screen with Claude's reasons: the demo's own sample folder, imported fresh. */
async function importShots(page: Page) {
  await inMode(page, "normal");
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-readme-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, folder, { recursive: true });
  await page.getByTestId("folder-input").setInputFiles(folder);
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 120_000 });
  await page.waitForURL(/\/p\/[^/]+\/setup$/, { timeout: 600_000 });
  await expect(page.getByRole("heading", { name: "Your course plan" })).toBeVisible({ timeout: 600_000 });
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];
  for (const mode of MODES) {
    await inMode(page, mode);
    await page.goto(`/p/${projectId}/setup`);
    const files = page.locator(".m-files-details").first();
    await files.locator("summary").click();
    await expect(page.locator(".m-file-reason").first()).toBeVisible({ timeout: 60_000 });
    await files.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
    await shoot(page, "import", mode);
  }
}
