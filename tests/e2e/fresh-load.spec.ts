import { expect, test, type Browser, type Page } from "@playwright/test";

// A brand-new tab must show everything on its first load, without a reload: the page as sent is readable, and the entrances only add to it.
// Each check opens its own fresh browser context (like a new tab), once normally and once with the page's scripts held back for 9 s, so
// nothing can depend on animation code having run. Fake engine, throwaway data folder (playwright.config.ts).
test.describe.configure({ mode: "serial" });

let demo = "";
test.beforeAll(async ({ request }) => {
  demo = ((await (await request.post("/api/demo")).json()) as { id: string }).id;
});

/** On screen and readable: every ancestor shown, and opaque (the agents' room is drawn dimmed on purpose, so it counts from 0.5). */
const visible = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.display === "none") return "hidden";
      o *= Number(s.opacity);
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return "no size";
    return o > (el.closest(".hall") ? 0.5 : 0.9) ? "visible" : `opacity ${o.toFixed(2)}`;
  }, selector);

async function freshTab(browser: Browser, path: string, slowScripts: boolean) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (slowScripts) await context.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => (await new Promise((r) => setTimeout(r, 9000)), route.continue()));
  const page = await context.newPage();
  await page.goto(path, { waitUntil: slowScripts ? "commit" : "load" });
  await page.waitForTimeout(3800); // after the CSS entrances (the greeting starts at about 2.2 s); with held-back scripts, still well before they arrive
  return { page, close: () => context.close() };
}

const scrollTo = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    window.scrollTo(0, (el.closest("section") ?? el).getBoundingClientRect().top + window.scrollY - 40);
  }, selector);

for (const slow of [false, true]) {
  const how = slow ? "with the scripts held back" : "as a fresh tab";
  test(`the home page and the project card show everything on first load, ${how}`, async ({ browser }) => {
    const { page, close } = await freshTab(browser, "/", slow);
    for (const sel of [".ho-word", ".ho-ink", ".ho-greet"]) expect(await visible(page, sel), sel).toBe("visible");
    await scrollTo(page, ".ho-tile");
    await page.waitForTimeout(slow ? 200 : 1200);
    expect(await visible(page, ".ho-tile h3")).toBe("visible");
    expect(await visible(page, ".ho-tile .hall-cam .hall-table"), "the round table on the card").toBe("visible");
    await close();
  });

  test(`the project overview and every scene show on first load, each in its own tab, ${how}`, async ({ browser }) => {
    test.setTimeout(slow ? 120_000 : 60_000);
    {
      const { page, close } = await freshTab(browser, `/p/${demo}`, slow);
      expect(await visible(page, "#ov-course")).toBe("visible");
      expect(await visible(page, ".ov-hall .hall-table"), "the round table").toBe("visible");
      expect(await visible(page, ".ov-tabs"), "the tabs").toBe("visible");
      const part = "[aria-labelledby^='ov-h-']";
      await scrollTo(page, part);
      await page.waitForTimeout(slow ? 200 : 1200);
      expect(await visible(page, part), part).toBe("visible");
      expect(await visible(page, `${part} h2`), `${part} h2`).toBe("visible");
      await close();
    }
    for (const [tab, scene, inside] of [
      ["talk", "#ov-talk-h", "[aria-labelledby='ov-talk-h'] .art-laptop"],
      ["lecture-notes", "#ov-weeks-h", "[aria-labelledby='ov-weeks-h'] .art-week"],
      ["exam", "#ov-exam-h", "[aria-labelledby='ov-exam-h'] .art-exam"],
      ["note-to-self", "#ov-note-h", "[aria-labelledby='ov-note-h'] .art-notebook"],
    ]) {
      const { page, close } = await freshTab(browser, `/p/${demo}?tab=${tab}`, slow);
      expect(await visible(page, scene), scene).toBe("visible");
      expect(await visible(page, inside), inside).toBe("visible");
      await close();
    }
  });
}

test("the page as sent hides nothing on the home page, and on the overview only decoration that cross-fades", async ({ request }) => {
  const hiddenIn = async (path: string) =>
    [...(await (await request.get(path)).text()).matchAll(/<(\w+)([^>]*)style="[^"]*(?:opacity:\s*0[;"]|visibility:\s*hidden)[^"]*"/g)].map((m) => /class="([^"]*)"|data-part="([^"]*)"/.exec(m[2])?.slice(1).find(Boolean) ?? m[1]);
  expect(await hiddenIn("/")).toEqual([]);
  // the backdrop's colour fields and icons for the other scenes (one is always showing), and the hero's thinking dots, on every tab
  for (const tab of ["layers", "talk", "lecture-notes", "exam", "note-to-self"]) for (const what of await hiddenIn(`/p/${demo}?tab=${tab}`)) expect(["bd-field", "bd-icons", "think"], tab).toContain(what);
});
