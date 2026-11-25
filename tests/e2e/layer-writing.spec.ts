import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";
import { dbAll, e2eDataDir, layerIdsOf, seedProject } from "./helpers";

/**
 * While a layer is written: its explanation streams in section by section, only the layer's own content area waits, and everything else
 * (the layer list, the back link, Escape, the course's other rooms) works. Leaving or switching layers never stops the writing. The fake
 * engine streams a layer titled "(fake: slow)" over about ten seconds. Both modes.
 */

const retitle = (id: string, title: string) => {
  const db = new Database(path.join(e2eDataDir(), "margin.db"));
  try {
    db.prepare("update layers set title = ? where id = ?").run(title, id);
  } finally {
    db.close();
  }
};
const statusOf = (id: string) => dbAll<{ s: string }>("select content_status as s from layers where id = ?", id)[0]?.s;
const draftText = (page: Page) => page.locator(".m-reading-pane .m-body[aria-busy='true']");
const writingLine = (page: Page) => page.getByRole("status").filter({ hasText: "the rest appears as it is written" });

// each test's course is deleted after it, so the courses other specs count on the home page stay as they were
const made: string[] = [];
test.afterEach(async ({ request }) => {
  for (const id of made.splice(0)) await request.delete(`/api/projects/${id}`);
});

async function slowLayer(page: Page, request: import("@playwright/test").APIRequestContext, name: string, mode: string) {
  const id = await seedProject(request, name);
  made.push(id);
  const layers = await layerIdsOf(page, id);
  retitle(layers[0], "Federalist 10 (fake: slow)");
  await page.addInitScript((m) => localStorage.setItem("margin:mode", m), mode);
  return { id, layers };
}

for (const mode of ["normal", "lock-in"] as const) {
  test(`the explanation streams in section by section while it is written, then becomes the layer's tabs, ${mode}`, async ({ page, request }) => {
    const { id, layers } = await slowLayer(page, request, `Streaming ${mode}`, mode);
    await page.goto(`/p/${id}/l/${layers[0]}`);
    // the first words arrive while the rest is still being written: a section heading and its text, under one quiet status line
    await expect(draftText(page).locator("h3").first()).toBeVisible({ timeout: 8_000 });
    await expect(writingLine(page)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Explained" })).toHaveCount(0);
    const early = (await draftText(page).textContent())?.length ?? 0;
    await expect.poll(async () => (await draftText(page).textContent())?.length ?? 0, { timeout: 8_000 }).toBeGreaterThan(early);
    // when it is done, the same explanation becomes the Explained tab, with Lecture and Source beside it
    await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("tab", { name: "Source" })).toBeVisible();
    await expect(writingLine(page)).toHaveCount(0);
    await expect(page.locator(".m-reading-pane h3").first()).toHaveText(/What is step 1 of the answer/);
  });

  test(`while a layer is written, the layer list switches layers and coming back finds the writing still going, ${mode}`, async ({ page, request }) => {
    const { id, layers } = await slowLayer(page, request, `Switching ${mode}`, mode);
    await page.goto(`/p/${id}/l/${layers[0]}`);
    await expect(draftText(page).locator("h3").first()).toBeVisible({ timeout: 8_000 });
    // another layer, from the list
    const other = page.locator(`.m-left a[href$='/l/${layers[1]}']:visible`).first();
    const title = (await other.locator(".m-sec-title").textContent())?.trim() ?? "";
    await other.click();
    await expect(page).toHaveURL(new RegExp(`/l/${layers[1]}$`));
    await expect(page.locator(".m-reading-pane:not([aria-busy]) h1:visible")).toHaveText(title);
    expect(statusOf(layers[0])).toBe("writing"); // leaving did not stop it
    // back to the first: the text so far, then the finished layer
    await page.locator(`.m-left a[href$='/l/${layers[0]}']:visible`).first().click();
    await expect(page).toHaveURL(new RegExp(`/l/${layers[0]}$`));
    await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 25_000 });
    expect(statusOf(layers[0])).toBe("ready");
  });

  test(`while a layer is written, the back link, Escape and the course's other rooms all work, and the writing goes on, ${mode}`, async ({ page, request }) => {
    const { id, layers } = await slowLayer(page, request, `Leaving ${mode}`, mode);
    const name = `Leaving ${mode}`;
    // the back link
    await page.goto(`/p/${id}/l/${layers[0]}`);
    await expect(draftText(page).locator("h3").first()).toBeVisible({ timeout: 8_000 });
    await page.getByRole("link", { name: `Back to ${name}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}(\\?tab=layers)?$`));
    expect(statusOf(layers[0])).toBe("writing");
    // Note to Self, from the list's footer
    retitle(layers[1], "Federalist 51 (fake: slow)");
    await page.goto(`/p/${id}/l/${layers[1]}`);
    await expect(draftText(page).locator("h3").first()).toBeVisible({ timeout: 8_000 });
    await page.getByRole("link", { name: "Note to Self" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}(/notes|\\?tab=note-to-self)$`));
    // Escape
    retitle(layers[2], "Federalist 70 (fake: slow)");
    await page.goto(`/p/${id}/l/${layers[2]}`);
    await expect(draftText(page).locator("h3").first()).toBeVisible({ timeout: 8_000 });
    await page.locator(".m-reading-pane").click({ position: { x: 5, y: 5 } }); // focus on the page, not a field
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/p/${id}(\\?tab=layers)?$`));
    // all three finish on their own
    await expect.poll(() => layers.slice(0, 3).map(statusOf), { timeout: 40_000 }).toEqual(["ready", "ready", "ready"]);
  });

  test(`while a layer is still opening, its frame's back link and layer list already work, ${mode}`, async ({ page, request }) => {
    const id = await seedProject(request, `Opening ${mode}`);
    made.push(id);
    const layers = await layerIdsOf(page, id);
    await page.addInitScript((m) => localStorage.setItem("margin:mode", m), mode);
    await page.goto(`/p/${id}/l/${layers[0]}`);
    await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 15_000 });
    // hold the next layer's answer, so its frame stays up
    await page.route(new RegExp(`/l/${layers[1]}`), async (route) => {
      if (route.request().headers()["rsc"]) await new Promise(() => {});
      await route.continue();
    });
    await page.locator(`.m-left a[href$='/l/${layers[1]}']:visible`).first().click();
    await expect(page.locator(".m-frame .m-reading-pane[inert]")).toBeVisible();
    // the frame's layer list is live: another layer of the week opens from it
    await page.locator(`.m-frame .m-left a[href$='/l/${layers[0]}']:visible`).first().click();
    await expect(page).toHaveURL(new RegExp(`/l/${layers[0]}$`));
    await expect(page.locator(".m-reading-pane:not([aria-busy]) .m-body:visible")).toBeVisible({ timeout: 15_000 });
    // and its back link
    await page.locator(`.m-left a[href$='/l/${layers[1]}']:visible`).first().click();
    await expect(page.locator(".m-frame .m-reading-pane[inert]")).toBeVisible();
    await page.locator(".m-frame").getByRole("link", { name: `Back to Opening ${mode}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${id}(\\?tab=layers)?$`));
  });
}
