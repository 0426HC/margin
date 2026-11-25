import { expect, test, type Page } from "@playwright/test";
import { layerIdsOf, seedProject } from "./helpers";

// A way back from every section page: "← Course name" at the top left, and Escape, both back to the course page on the tab the student
// came from (the Mac app's window has no back button). Both modes. Fake engine, throwaway data folder.
test.describe.configure({ mode: "serial" });

const COURSE = "Back Course";
let id = "";
let layer = "";
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, COURSE);
  const page = await browser.newPage();
  layer = (await layerIdsOf(page, id))[0];
  await page.close();
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

type Tab = "layers" | "talk" | "lecture-notes" | "exam" | "note-to-self";
const LABEL: Record<Tab, RegExp> = { layers: /^Layers/, talk: /^Let’s talk!/, "lecture-notes": /^Lecture notes/, exam: /^Exam room/, "note-to-self": /^Note to Self/ };
/** Each section page, and a tab of the course page to arrive from that is not its own. */
const sections = (): { name: string; path: string; own: Tab; from: Tab }[] => [
  { name: "Note to Self", path: `/p/${id}/notes`, own: "note-to-self", from: "exam" },
  { name: "Let's talk!", path: `/p/${id}/talk`, own: "talk", from: "note-to-self" },
  { name: "Lecture notes", path: `/p/${id}/lecture-notes`, own: "lecture-notes", from: "talk" },
  { name: "Exam room", path: `/p/${id}/exam`, own: "exam", from: "lecture-notes" },
  { name: "a layer", path: `/p/${id}/l/${layer}`, own: "layers", from: "exam" },
  { name: "a week synthesis", path: `/p/${id}/week/1/synthesis`, own: "layers", from: "talk" },
];

async function mode(page: Page, m: "normal" | "lock-in") {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate((v) => localStorage.setItem("margin:mode", v), m);
}
const back = (page: Page) => page.getByRole("link", { name: `Back to ${COURSE}` });
/** The course page, opened by its address, on one tab. */
async function course(page: Page, tab: Tab) {
  await page.goto(`/p/${id}?tab=${tab}`);
  await expect(page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: LABEL[tab] })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}
/** Into a section from inside the app, as any link there does (no reload). */
async function into(page: Page, path: string) {
  await page.evaluate((p) => (window as unknown as { next: { router: { push: (h: string) => void } } }).next.router.push(p), path);
  await page.waitForURL((u) => u.pathname === path, { timeout: 30_000 });
  // a layer's loading frame has a working back link of its own: wait for the layer itself, so the one measured stays
  await expect(page.locator(".m-frame")).toHaveCount(0, { timeout: 30_000 });
  await expect(back(page)).toBeVisible({ timeout: 30_000 });
}
/** Back on the course page, on this tab. */
async function landedOn(page: Page, tab: Tab) {
  await page.waitForURL(new RegExp(`/p/${id}\\?tab=${tab}$`), { timeout: 15_000 });
  await expect(page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: LABEL[tab] })).toHaveAttribute("aria-current", "page");
}
const nothingFocused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

for (const m of ["normal", "lock-in"] as const) {
  test(`${m}: the back link at the top left of every section page returns to the tab the student came from`, async ({ page }) => {
    await mode(page, m);
    for (const s of sections()) {
      await course(page, s.from);
      await into(page, s.path);
      // top left: the first thing in the bar, reading "← Course name"
      await expect(back(page)).toHaveText(new RegExp(`^←\\s*${COURSE}$`));
      const box = (await back(page).boundingBox())!;
      expect(box.x, `${s.name}: at the left`).toBeLessThan(40);
      expect(box.y, `${s.name}: at the top`).toBeLessThan(40);
      await back(page).click();
      await landedOn(page, s.from);
    }
  });

  test(`${m}: Escape does the same from every section page, but not while typing or while something is open on top`, async ({ page }) => {
    await mode(page, m);
    for (const s of sections()) {
      await course(page, s.from);
      await into(page, s.path);
      await nothingFocused(page);
      await page.keyboard.press("Escape");
      await landedOn(page, s.from);
    }

    // typing: Escape belongs to the text field
    await course(page, "talk");
    await into(page, `/p/${id}/l/${layer}`);
    const writing = page.getByRole("textbox", { name: "Write this layer in your own words" });
    await writing.click();
    await writing.pressSequentially("half a thought");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    expect(new URL(page.url()).pathname).toBe(`/p/${id}/l/${layer}`);
    await expect(writing).toHaveValue("half a thought");

    // the command bar is open: the first Escape closes it, the next one leaves
    await nothingFocused(page);
    await page.keyboard.press("ControlOrMeta+k");
    const bar = page.getByRole("dialog", { name: "Command bar" });
    await expect(bar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(new URL(page.url()).pathname).toBe(`/p/${id}/l/${layer}`);
    await nothingFocused(page);
    await page.keyboard.press("Escape");
    await landedOn(page, "talk");

    // the Note to Self chat is a text field too
    await course(page, "exam");
    await into(page, `/p/${id}/notes`);
    const ask = page.getByRole("textbox", { name: "Ask about your notes" });
    await ask.click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    expect(new URL(page.url()).pathname).toBe(`/p/${id}/notes`);
  });

  test(`${m}: a section page opened by its address leads back to its own tab`, async ({ page }) => {
    await mode(page, m);
    for (const s of sections()) {
      await page.goto(s.path);
      await expect(back(page)).toBeVisible({ timeout: 30_000 });
      await expect(back(page)).toHaveAttribute("href", `/p/${id}?tab=${s.own}`);
    }
    await back(page).click();
    await landedOn(page, "layers");
  });
}
