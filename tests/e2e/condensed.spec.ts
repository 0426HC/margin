import { expect, test, type Page } from "@playwright/test";
import { seedProject } from "./helpers";

// Condensed notes (one page per project, both modes, editable with nothing saved), and places to type showing no frame when clicked: only a
// thin plum edge when reached with the keyboard. Fake engine, throwaway data folder.
test.describe.configure({ mode: "serial" });

let id = "";
test.beforeAll(async ({ request }) => {
  id = await seedProject(request, "Condensed Course"); // nothing sent to Note to Self
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

async function mode(page: Page, m: "normal" | "lock-in") {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate((v) => localStorage.setItem("margin:mode", v), m);
}
async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
const TEXT = "Union -> safety and freedom.\nJudge the reasons, not the motives.";
const SAVED = "Union → safety and freedom.\nJudge the reasons, not the motives.";

test("condensed notes with nothing saved: typed in lock in, there after a reload and in the notebook; typed in the notebook, there in lock in", async ({ page }) => {
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=note-to-self`);
  await expect(page.getByText("Nothing is in Note to Self yet.")).toBeVisible(); // zero saved layers
  const field = page.getByRole("region", { name: "Condensed notes" }).getByRole("textbox", { name: "Condensed notes" });
  await expect(field).toBeEditable();
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${id}/condensed-notes`) && r.request().method() === "PUT" && r.ok(), { timeout: 20_000 });
  await field.click();
  await page.keyboard.type(TEXT);
  await expect(field).toHaveValue(SAVED);
  await saved; // the autosave went through
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("textbox", { name: "Condensed notes" })).toHaveValue(SAVED);

  // the other mode: the notebook's left page is the same page, there at once (no switch), with nothing saved on the right
  await mode(page, "normal");
  await go(page, `/p/${id}/notes`);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 4000 });
  await expect(page.getByRole("group", { name: "Notes page" })).toHaveCount(0);
  await expect(page.locator(".nb-entry")).toHaveCount(0); // zero saved layers
  const book = page.locator(".nb-book .nb-l").getByRole("textbox", { name: "Condensed notes" });
  await expect(book).toBeEditable();
  await expect(book).toHaveValue(SAVED);

  // written in the notebook, read in lock in (also without a reload, by switching in place)
  await book.click();
  await book.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(e.value.length, e.value.length));
  const again = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${id}/condensed-notes`) && r.request().method() === "PUT" && r.ok(), { timeout: 20_000 });
  await page.keyboard.type("\nShorter still.");
  await again;
  await page.getByRole("switch", { name: "Lock in" }).click();
  await expect(page.locator(".lk-nts").getByRole("textbox", { name: "Condensed notes" })).toHaveValue(`${SAVED}\nShorter still.`);
  await go(page, `/p/${id}?tab=note-to-self`);
  await expect(page.getByRole("textbox", { name: "Condensed notes" })).toHaveValue(`${SAVED}\nShorter still.`);
});

/** The outline a field shows right now. */
const outline = (page: Page, loc: ReturnType<Page["locator"]>) => loc.evaluate((e) => { const c = getComputedStyle(e); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; });

test("clicking into a place to type shows no frame in either mode; reaching it with the keyboard shows a thin plum edge", async ({ page }) => {
  for (const m of ["lock-in", "normal"] as const) {
    await mode(page, m);
    // the Let's talk! notepad (an editable page), inside the course page in lock in and on its own page in normal mode
    await go(page, m === "lock-in" ? `/p/${id}?tab=talk` : `/p/${id}/talk`);
    await page.getByRole("tab", { name: "Notepad" }).click();
    const pad = page.getByRole("textbox", { name: "Notepad" });
    await pad.click();
    await expect(pad).toBeFocused();
    expect((await outline(page, pad)).style, `${m}: notepad clicked`).toBe("none");
    // the search box and the chat's text area, clicked
    const search = page.getByRole("searchbox");
    await search.click();
    expect((await outline(page, search)).style, `${m}: search clicked`).toBe("none");
    await page.getByRole("tab", { name: "Chat" }).click();
    const ask = page.getByRole("textbox", { name: "Ask your professor" });
    await ask.click();
    expect((await outline(page, ask)).style, `${m}: chat box clicked`).toBe("none");
    // reached with the keyboard: a thin plum edge
    await page.getByRole("tab", { name: "Chat" }).focus();
    for (let i = 0; i < 30 && !(await ask.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(ask).toBeFocused();
    expect(await outline(page, ask), `${m}: chat box by keyboard`).toEqual({ style: "solid", width: "1px", color: "rgb(107, 44, 126)" });
    // a click after that is a click again: no frame
    await ask.click();
    expect((await outline(page, ask)).style, `${m}: clicked after Tab`).toBe("none");
  }
  // Note to Self's condensed page in lock in, and the notebook's in normal mode
  await mode(page, "lock-in");
  await go(page, `/p/${id}?tab=note-to-self`);
  const field = page.getByRole("textbox", { name: "Condensed notes" });
  await field.click();
  expect((await outline(page, field)).style).toBe("none");
  // and a box with a border keeps its border, gaining nothing on click (the focus timer's minutes)
  await page.getByRole("button", { name: "Focus timer" }).click();
  const minutes = page.getByRole("spinbutton").or(page.getByRole("textbox", { name: /minutes/i })).first();
  await minutes.click();
  expect((await outline(page, minutes)).style).toBe("none");
});
