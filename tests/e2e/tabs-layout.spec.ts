import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedProject } from "./helpers";

// The course page's layout: the header (top bar and tabs) pinned and never covering the page, the weeks below it, each tab's scene filling
// exactly the space below it at laptop and desktop sizes, and the sidebar grouped by week. Fake engine, throwaway data.
test.describe.configure({ mode: "serial" });

const SIZES = [
  [1280, 800],
  [1440, 900],
  [1680, 1050],
  [1920, 1080],
] as const;
let id = "";
test.beforeAll(async ({ request }) => {
  id = await seedProject(request, "Layout Course");
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

async function fresh(browser: Browser, mode: "normal" | "lock-in", w = 1440, h = 900) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    storageState: { cookies: [], origins: [{ origin: "http://localhost:" + (process.env.E2E_PORT ?? 3100), localStorage: [{ name: "margin:lock-in-hint-seen", value: "1" }, { name: "margin:weeks-hint-seen", value: "1" }, { name: "margin:mode", value: mode }] }] },
  });
  return { context, page: await context.newPage() };
}
const settle = async (page: Page, ms = 1200) => {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
};

/** The brightest pixel (0–255 luminance) in a region of the screen as it is painted: decoded in the page from a real screenshot. */
async function brightest(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    return max;
  }, png);
}
const box = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; });

test("the header (top bar and tabs) stays pinned and painted on top while the Layers tab scrolls, with nothing painted behind it", async ({ browser }) => {
  for (const [w, h] of SIZES) {
    const { context, page } = await fresh(browser, "normal", w, h);
    await page.goto(`/p/${id}?tab=layers`);
    await settle(page);
    const head = await box(page, ".ov-head");
    // scroll through the opening and every week, like a person would
    await page.mouse.move(w / 2, h / 2);
    for (const k of [0, 1, 2]) {
      await page.evaluate((k) => {
        const el = document.querySelectorAll("section.ov-scene")[k] as HTMLElement;
        window.scrollTo(0, el.getBoundingClientRect().top + scrollY + el.offsetHeight - innerHeight);
      }, k);
      await page.waitForTimeout(1300);
      // the tabs are still where they were, and they are what is painted there: the active tab's white label shows
      const tabs = await box(page, ".ov-tabs");
      expect(Math.round(tabs.top), `${w}x${h}`).toBe(Math.round(head.top + 56));
      const active = await box(page, '.ov-tab[aria-current="page"]');
      expect(await brightest(page, { x: active.left, y: active.top + 10, width: active.width, height: 22 }), `active tab painted at ${w}x${h}`).toBeGreaterThan(200);
      const word = await box(page, ".ov-wordmark");
      expect(await brightest(page, { x: word.left, y: word.top, width: word.width, height: word.height }), `wordmark painted at ${w}x${h}`).toBeGreaterThan(200);
      // and nothing is painted behind it: no band, so no edge where it ends
      expect(await page.locator(".ov-head").evaluate((e) => getComputedStyle(e, "::before").content)).toBe("none");
    }
    await context.close();
  }
});

test("nothing in the Layers tab sits under the header: the opening, each week's sheets, labels and headline, and the rail", async ({ browser }) => {
  for (const [w, h] of SIZES) {
    const { context, page } = await fresh(browser, "normal", w, h);
    await page.goto(`/p/${id}?tab=layers`);
    await settle(page);
    const headBottom = (await box(page, ".ov-head")).bottom;
    // the opening: its title and progress below the header
    for (const sel of ["#ov-course", ".ov-intro-stat"]) expect((await box(page, sel)).top, `${sel} at ${w}x${h}`).toBeGreaterThanOrEqual(headBottom);
    // each week, at the point where every sheet and label is out
    for (const k of [0, 1, 2]) {
      await page.evaluate((k) => {
        const el = document.querySelectorAll("section.ov-scene")[k] as HTMLElement;
        window.scrollTo(0, el.getBoundingClientRect().top + scrollY + el.offsetHeight - innerHeight);
      }, k);
      await page.waitForTimeout(1300);
      const r = await page.evaluate((k) => {
        const sc = document.querySelectorAll("section.ov-scene")[k];
        const stage = sc.querySelector(".ov-stage")!.getBoundingClientRect();
        const things = [...sc.querySelectorAll(".ov-sheet, .ov-label, .ov-title, .ov-kicker, .ov-part-go")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
        const over = [...sc.querySelectorAll(".ov-sheet, .ov-label, .ov-title, .ov-kicker, .ov-part-go")].filter((e) => e.getBoundingClientRect().bottom > innerHeight).map((e) => `${e.className.slice(0, 24)}:${(e.textContent ?? "").slice(0, 30)}`).join(" | ");
        return { over, stageTop: stage.top, stageBottom: stage.bottom, top: Math.min(...things.map((b) => b.top)), bottom: Math.max(...things.map((b) => b.bottom)) };
      }, k);
      expect(Math.round(r.stageTop), `Week ${k + 1} stage at ${w}x${h}`).toBe(Math.round(headBottom));
      expect(Math.round(r.stageBottom)).toBe(h);
      expect(r.top, `Week ${k + 1} content at ${w}x${h}`).toBeGreaterThanOrEqual(headBottom);
      expect(r.bottom, `Week ${k + 1} bottom at ${w}x${h}: ${r.over}`).toBeLessThanOrEqual(h);
    }
    // the rail sits in the space below the header
    const rail = await box(page, ".ov-rail");
    expect(rail.top).toBeGreaterThan(headBottom);
    expect(rail.bottom).toBeLessThan(h);
    await context.close();
  }
});

test("Let's talk!, Lecture notes, Exam room and Note to Self fit exactly below the header at every size, in both modes, with no page scroll", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const mode of ["normal", "lock-in"] as const) {
    for (const [w, h] of SIZES) {
      const { context, page } = await fresh(browser, mode, w, h);
      for (const tab of ["talk", "lecture-notes", "exam", "note-to-self"]) {
        // each on a fresh load of its own address
        await page.goto(`/p/${id}?tab=${tab}`);
        await settle(page, mode === "normal" ? 1500 : 600);
        const where = `${mode} ${tab} ${w}x${h}`;
        expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), where).toBeLessThanOrEqual(0);
        await page.mouse.move(w * 0.2, h * 0.5);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => scrollY), where).toBe(0);
        const headBottom = (await box(page, ".ov-head")).bottom;
        expect(headBottom, where).toBeLessThanOrEqual(110);
        if (mode === "normal") {
          // the scene fills the space below the header; text and illustration are centred together in it
          const stage = await box(page, ".ov-free-stage");
          expect(Math.round(stage.top), where).toBe(Math.round(headBottom));
          expect(Math.round(stage.bottom), where).toBe(h);
          const text = await box(page, ".ov-free-text");
          const art = await box(page, ".ov-free-art");
          const mid = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;
          expect(Math.abs(mid(text) - mid(art)), `${where}: centres line up`).toBeLessThan(h * 0.04);
          expect(Math.abs(mid(art) - (headBottom + h) / 2), `${where}: centred in the space`).toBeLessThan(h * 0.04);
          expect(text.top, where).toBeGreaterThan(headBottom);
          // the illustration fills its half: about three quarters of the height, beside the text
          expect(art.height, where).toBeGreaterThan((h - headBottom) * 0.7);
          expect(art.left, where).toBeGreaterThan(text.right - 1);
          // the background icons keep clear of the text and the illustration
          const overlaps = await page.evaluate(() => {
            const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
            const t = rect(".ov-free-text");
            const a = rect(".ov-free-art");
            const hit = (b: DOMRect, r: DOMRect) => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
            return [...document.querySelectorAll(".bd-icon")]
              .filter((e) => Number(getComputedStyle(e.parentElement!).opacity) > 0.3)
              .map((e) => e.getBoundingClientRect())
              .filter((b) => hit(b, t) || hit(b, a)).length;
          });
          expect(overlaps, `${where}: icons over the text or illustration`).toBe(0);
        } else {
          // the real page fills the space below the header
          const real = await box(page, ".ov-embed > *");
          expect(Math.round(real.top), where).toBeGreaterThanOrEqual(Math.round(headBottom) - 1);
          expect(Math.round(real.bottom), where).toBe(h);
        }
      }
      await context.close();
    }
  }
});

test("Lecture notes: with three weeks the sheets still stand large, as one group with the week number", async ({ browser }) => {
  const { context, page } = await fresh(browser, "normal", 1440, 900);
  await page.goto(`/p/${id}?tab=lecture-notes`);
  await settle(page, 1500);
  await expect(page.locator(".art-week")).toHaveCount(3);
  const front = await box(page, '.art-week[data-week="0"] .art-week-face');
  expect(front.height).toBeGreaterThan(250); // a sheet is a substantial thing, not a sliver
  const sheets = await box(page, ".art-weeks-sheets svg");
  const num = await box(page, ".art-weeks-now");
  const mid = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;
  expect(Math.abs(mid(sheets) - mid(num))).toBeLessThan(120); // side by side, one group
  expect(num.left - sheets.right).toBeLessThan(200);
  await context.close();
});

test("the week scenes: 'Week N of 3' above the week's title, no per-layer week labels; the sidebar lists the same weeks with no switch", async ({ browser }) => {
  const { context, page } = await fresh(browser, "normal", 1440, 900);
  await page.goto(`/p/${id}?tab=layers`);
  await settle(page);
  await page.evaluate(() => {
    const el = document.querySelector("section.ov-scene") as HTMLElement;
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY + el.offsetHeight - innerHeight);
  });
  await page.waitForTimeout(1300);
  const scene = page.locator("section.ov-scene").first();
  await expect(scene.locator(".ov-kicker").first()).toHaveText("Week 1 of 3");
  await expect(scene.getByRole("heading", { level: 2 })).toHaveText(/^Week 1 · Why a new government\?/);
  expect(await scene.locator(".ov-label").count()).toBeGreaterThan(0);
  await expect(scene.locator(".ov-label-wk")).toHaveCount(0);

  // the sidebar inside a course: the same weeks, no Layers | Weeks switch, no week labels
  await page.goto(`/p/${id}/talk`);
  await settle(page, 400);
  const side = page.getByRole("navigation", { name: "Layers" });
  await expect(side.getByRole("group", { name: "List the layers by" })).toHaveCount(0);
  expect((await side.locator(".m-lunit-title").allInnerTexts()).map((t) => t.split(" · ")[0])).toEqual(["Week 1", "Week 2", "Week 3"]);
  await expect(side.locator(".m-sec-wk").filter({ hasText: /^wk / })).toHaveCount(0);
  await context.close();
});

// ---------------------------------------------------------------- the header floats; the content dissolves below it

/** The mean luminance (0–255) of one row of screen pixels, across the full width, as painted. */
async function rowMean(page: Page, y: number, width: number) {
  const png = (await page.screenshot({ clip: { x: 0, y, width, height: 1 } })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, png);
}

for (const mode of ["normal", "lock-in"] as const) {
  test(`Layers tab, ${mode}: no band or line at the header's bottom edge, at the top and after scrolling`, async ({ browser }) => {
    const w = 1440;
    const { context, page } = await fresh(browser, mode, w, 900);
    await page.goto(`/p/${id}?tab=layers`);
    await settle(page);
    const edge = Math.round((await box(page, ".ov-head")).bottom);
    for (const y of [0, 900]) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(1300);
      // rows just above the edge (behind the header) and just below it (the page) are the same backdrop: no step in brightness
      const rows = await Promise.all([edge - 4, edge - 1, edge, edge + 1, edge + 4].map((r) => rowMean(page, r, w)));
      const spread = Math.max(...rows) - Math.min(...rows);
      expect(spread, `${mode}, scrolled ${y}: rows ${rows.map((r) => r.toFixed(1)).join(", ")}`).toBeLessThan(3);
    }
    await context.close();
  });

  test(`Layers tab, ${mode}: content scrolled under the header is invisible there, and fully visible lower down`, async ({ browser }) => {
    const { context, page } = await fresh(browser, mode, 1440, 900);
    await page.goto(`/p/${id}?tab=layers`);
    await settle(page);
    await page.mouse.move(720, 500);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(1500);
    const edge = (await box(page, ".ov-head")).bottom;
    const strip = { x: 664, y: 10, width: 112, height: Math.round(edge - 20) };
    const empty = await brightest(page, strip); // the backdrop alone there (a star may twinkle)
    // a bright white block inside the scrolling content, placed (in page coordinates) so it sits behind the header, in a strip of the header
    // with nothing of its own (between the tabs and the buttons); and a second one well below the header
    await page.evaluate(({ edge }) => {
      const host = document.querySelector<HTMLElement>(".ov-tabbed > .ov-main, .ov-tabbed > .lk-ov")!;
      const { top, left } = host.getBoundingClientRect();
      for (const [id, y] of [["probe-under", 8], ["probe-below", edge + 200]] as const) {
        const b = document.createElement("div");
        b.id = id;
        Object.assign(b.style, { position: "absolute", left: `${660 - left}px`, width: "120px", top: `${y - top}px`, height: `${Math.round(edge - 16)}px`, background: "#fff", zIndex: "50" });
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        host.appendChild(b);
      }
    }, { edge });
    await page.waitForTimeout(100);
    const under = await box(page, "#probe-under");
    expect(under.bottom).toBeLessThanOrEqual(edge);
    expect(under.left).toBeLessThanOrEqual(strip.x);
    expect(await brightest(page, strip), `${mode}: hidden behind the header (backdrop alone: ${empty})`).toBeLessThan(Math.max(empty + 25, 60));
    const below = await box(page, "#probe-below");
    expect(await brightest(page, { x: below.left + 4, y: below.top + 4, width: below.width - 8, height: below.height - 8 }), `${mode}: visible below it`).toBeGreaterThan(250);
    await context.close();
  });
}

test("an extension rewriting the lock in boot script before React loads causes no hydration error, and lock in still works", async ({ browser }) => {
  const { context, page } = await fresh(browser, "lock-in", 1440, 900);
  // like an ad-helper extension: rewrite the inline <script> in <head> as soon as it is parsed (after it ran)
  await context.addInitScript(() => {
    new MutationObserver((records, obs) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (n instanceof HTMLScriptElement && !n.src && n.parentElement === document.head && n.textContent?.includes("margin")) {
            n.textContent = `${n.textContent}\n/* rewritten by an extension */`;
            n.setAttribute("data-ext", "1");
            obs.disconnect();
          }
    }).observe(document, { childList: true, subtree: true });
  });
  const errors: string[] = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/p/${id}?tab=layers`);
  await settle(page, 2000);
  expect(await page.evaluate(() => document.head.querySelector("script[data-ext]") !== null)).toBe(true);
  expect(errors.filter((e) => /hydrat|didn't match/i.test(e)), errors.join("\n")).toEqual([]);
  // the Next.js dev overlay shows no issue badge
  expect(await page.evaluate(() => [...document.querySelectorAll("nextjs-portal")].some((p) => /Issue/.test(p.shadowRoot?.textContent ?? "")))).toBe(false);
  await expect(page.locator("html")).toHaveAttribute("data-lockin", /.*/);
  await expect(page.locator(".lk-ov")).toBeVisible();
  await context.close();
});

/** The colour of each row of a vertical strip 40 px wide, from y0 to y1, as painted: the median of each channel across the strip, so a
 *  thin line or a star crossing it does not count. */
async function column(page: Page, x: number, y0: number, y1: number) {
  const png = (await page.screenshot({ clip: { x, y: y0, width: 40, height: y1 - y0 } })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
    const rows: [number, number, number][] = [];
    for (let y = 0; y < c.height; y++) {
      const ch: number[][] = [[], [], []];
      for (let x = 0; x < c.width; x++) for (let k = 0; k < 3; k++) ch[k].push(d[(y * c.width + x) * 4 + k]);
      rows.push([med(ch[0]), med(ch[1]), med(ch[2])]);
    }
    return rows;
  }, png);
}
// Calibrated on the demo course at 1440x900 (CALIBRATE=1 prints the values): the room's old hard top (floor and vignette) measured 9 to 15 across the edge at
// x 300 and 720 (and 14.8 over 32 px); with the room's edge faded it was at most 4 across and 7.5 over 32 px.
const STEP = 5, BAND = 9, ACROSS = 6;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("Layers tab: the backdrop changes smoothly through the header's bottom edge, on the opening and as it scrolls away into week 1", async ({ browser }) => {
  const { context, page } = await fresh(browser, "normal", 1440, 900);
  await page.goto(`/p/${id}?tab=layers`);
  await settle(page, 1800);
  // only the backdrops are measured: the page's own, and the opening room's vignette. The content (titles, agents, sheets)
  // is hidden for the measurement (its fade under the header is tested above), and so is the header's own text: it has no background.
  const edge = Math.round((await box(page, ".ov-head")).bottom);
  await page.addStyleTag({ content: ".ov-head, .ov-rail, .ov-corner, .dev, .ov-intro-in > :not(.ov-hall), .ov-hall .hall-props, .ov-hall .hall-agent, .ov-hall .hall-caption, section.ov-scene { opacity: 0 !important; }" });
  const intro = await page.locator(".ov-intro").evaluate((e) => (e as HTMLElement).offsetHeight);
  const xs = [300, 720, 1000, 1250];
  for (const [where, y] of [["the opening", 0], ["the opening leaving", 900], ["week 1, right after", intro]] as const) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(1500);
    for (const x of xs) {
      const rows = await column(page, x, edge - 60, edge + 200);
      // no step from one row to the next, and no quick change of shade across any 32 px (a soft line is still a line)
      let step = 0;
      let band = 0;
      for (let i = 1; i < rows.length; i++) step = Math.max(step, dist(rows[i], rows[i - 1]));
      for (let i = 32; i < rows.length; i++) band = Math.max(band, dist(rows[i], rows[i - 32]));
      // straight across the edge: the shade just above it (behind the header) against 40 px below it, each the mean of 9 rows
      const mean = (c: number) => [0, 1, 2].map((k) => rows.slice(c - 4, c + 5).reduce((t, r) => t + r[k], 0) / 9);
      const across = dist(mean(60 - 10), mean(60 + 40));
      if (process.env.CALIBRATE) { console.log(`CAL ${where} x${x} step=${step.toFixed(2)} band=${band.toFixed(2)} across=${across.toFixed(2)}`); continue; }
      expect(across, `${where}, x ${x}: shade above against below the edge`).toBeLessThan(ACROSS);
      expect(step, `${where}, x ${x}: step between rows`).toBeLessThan(STEP);
      expect(band, `${where}, x ${x}: change across 32 px`).toBeLessThan(BAND);
    }
  }
  await context.close();
});
