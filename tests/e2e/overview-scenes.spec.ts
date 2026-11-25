import { expect, test, type Page } from "@playwright/test";
import { layerIdsOf, seedProject } from "./helpers";

// The overview's scenes beside the weeks: each in its own tab, about one screen, fading up as its tab opens; the Layers tab scrolled freely
// (nothing snaps); a top bar with no background at the top of the page; the Margin hero in every scene; Lecture notes picked with the wheel
// or the keys. Fake engine.
test.describe.configure({ mode: "serial" });

let id = "";
let layers: string[] = [];
test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Scenes Course");
  const page = await browser.newPage();
  layers = await layerIdsOf(page, id);
  await page.close();
  await request.post(`/api/projects/${id}/talk`, { data: { question: "What do the readings say about faction?" } });
  await request.post(`/api/projects/${id}/sources/find`);
  await request.put(`/api/projects/${id}/notepad`, { data: { blocks: [{ type: "heading", text: "My notes" }, { type: "bullet", text: "faction is the danger" }] } });
  await request.put(`/api/projects/${id}/weeks/2/notes`, { data: { blocks: [{ type: "paragraph", text: "Week two lecture notes" }] } });
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const TAB: Record<string, string> = { "Let’s talk!": "talk", "Lecture notes": "lecture-notes", "The exam room": "exam", "Note to Self": "note-to-self" };
/** Open a scene's tab and let it settle. */
const open = async (page: Page, name: string) => {
  await page.goto(`/p/${id}?tab=${TAB[name]}`);
  await page.waitForLoadState("networkidle");
  const scene = page.getByRole("region", { name });
  await page.waitForTimeout(1200);
  return scene;
};
/** Count wheel events that the sheets let go of: they travel on to the window, where the page (Lenis) would scroll. */
const countLetGo = (page: Page) => page.evaluate(() => ((window as unknown as { __letGo: number }).__letGo = 0, window.addEventListener("wheel", () => (window as unknown as { __letGo: number }).__letGo++)));
const letGo = (page: Page) => page.evaluate(() => (window as unknown as { __letGo: number }).__letGo);
const box = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!;
const heroAt = (scene: ReturnType<Page["locator"]>) => scene.locator(".hero").evaluate((el) => (el as SVGGElement).style.transform);

test("Let's talk!: a laptop open on the Let's talk! page, the professor typing, the hero hopping on the keys", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const scene = await open(page, "Let’s talk!");
  await expect(scene.locator(".ov-kicker")).toHaveText("Beside the weeks");
  await expect(scene.locator(".ov-free-status")).toContainText(/1 question · \d+ sources? · 2 notepad lines/);
  const art = scene.getByRole("img", { name: /laptop open on Let’s talk!/ });
  await expect(art.getByText("Hi, let’s discuss!")).toBeAttached();
  await expect(art.getByText("Ask your professor")).toBeAttached();
  await expect(art.locator(".art-dot").first()).toHaveCSS("animation-duration", "1.4s");
  // no student; one hero, and it moves
  await expect(scene.locator(".art-student")).toHaveCount(0);
  await expect(scene.locator(".hero")).toHaveCount(1);
  const a = await heroAt(scene);
  await page.waitForTimeout(700);
  expect(await heroAt(scene)).not.toBe(a);
  const text = await box(scene.locator(".ov-free-text"));
  const pic = await box(scene.locator(".ov-free-art"));
  expect(pic.x).toBeGreaterThan(text.x + text.width - 1);
  expect(errors).toEqual([]);
  await scene.getByRole("link", { name: "Open Let’s talk!" }).click();
  await page.waitForURL(new RegExp(`/p/${id}/talk$`));
});

test("Lecture notes: a sheet per week, week 1 at the front, plum tabs on weeks with notes, no button, the hero on the current week", async ({ page }) => {
  const scene = await open(page, "Lecture notes");
  await expect(scene.locator(".ov-free-status")).toHaveText("1 of 3 weeks have notes");
  await expect(scene.getByRole("link", { name: /Open Lecture notes/ })).toHaveCount(0);
  await expect(scene.locator(".art-week")).toHaveCount(3);
  await expect(scene.locator(".art-week-tab")).toHaveCount(1);
  // week 1 stands at the front: drawn last, lowest and furthest left
  const front = await scene.locator('.art-week[data-week="0"] .art-week-face').boundingBox();
  const back = await scene.locator('.art-week[data-week="2"] .art-week-face').boundingBox();
  expect(front!.x).toBeLessThan(back!.x);
  expect(front!.y + front!.height).toBeGreaterThan(back!.y + back!.height);
  // no syllabus dates: the current week is the latest one with notes
  await expect(scene.locator(".art-weeks-when")).toHaveText("WEEK 2 OF 3");
  await expect(scene.locator(".art-weeks-has")).toHaveText("● Has notes");
  await expect(scene.locator('.art-week[data-near][data-week="1"]')).toHaveCount(1);
  await expect(scene.locator(".art-weeks-hint")).toHaveText("Scroll on the sheets to pick a week · Click to open it");
  await expect(scene.locator(".hero")).toHaveCount(1);
});

test("Lecture notes: the wheel over the sheets moves the week, stays between weeks when stopped halfway, then lets the page scroll on", async ({ page }) => {
  const scene = await open(page, "Lecture notes");
  const sheets = scene.locator(".art-weeks-sheets");
  const b = await box(sheets);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const y0 = await page.evaluate(() => scrollY);
  await countLetGo(page);
  const when = scene.locator(".art-weeks-when");

  await page.mouse.wheel(0, 55); // half a sheet
  await expect(when).toHaveText("BETWEEN WEEK 2 AND 3");
  await page.waitForTimeout(800); // stopped: it stays in the air, nothing snaps
  await expect(when).toHaveText("BETWEEN WEEK 2 AND 3");
  // the odometer is half way between 2 and 3
  const roll = await scene.locator(".art-weeks-roll").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).f / el.getBoundingClientRect().height);
  expect(roll).toBeCloseTo(-1.5 / 3, 2);
  expect(await page.evaluate(() => scrollY)).toBe(y0); // the page did not move

  await page.mouse.wheel(0, 55);
  await expect(when).toHaveText("WEEK 3 OF 3");
  await expect(scene.locator(".art-weeks-none")).toHaveText("No notes yet");
  await expect(scene.locator('.art-week[data-near][data-week="2"]')).toHaveCount(1);
  expect(await page.evaluate(() => scrollY)).toBe(y0);
  expect(await letGo(page)).toBe(0); // so far the sheets kept every wheel step

  // at the last week the wheel is let go: it goes on to the page (in its own tab the scene is one screen, so there is little to scroll)
  await page.mouse.wheel(0, 200);
  await expect.poll(() => letGo(page)).toBeGreaterThan(0);
  await expect(when).toHaveText("WEEK 3 OF 3");
});

test("Lecture notes: scrolling up walks back to week 1 and then lets the page scroll up; a click opens that week", async ({ page }) => {
  const scene = await open(page, "Lecture notes");
  const b = await box(scene.locator(".art-weeks-sheets"));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const y0 = await page.evaluate(() => scrollY);
  await countLetGo(page);
  await page.mouse.wheel(0, -110);
  await expect(scene.locator(".art-weeks-when")).toHaveText("WEEK 1 OF 3");
  expect(await page.evaluate(() => scrollY)).toBe(y0);
  expect(await letGo(page)).toBe(0);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => letGo(page)).toBeGreaterThan(0); // at week 1 the wheel goes on to the page
  // clicking a sheet opens that week's notes
  const scene2 = await open(page, "Lecture notes");
  await scene2.locator('.art-week[data-week="0"] .art-week-face').click({ position: { x: 10, y: 60 } });
  await page.waitForURL(new RegExp(`/p/${id}/lecture-notes/1$`));
});

test("Lecture notes: the sheets take the keyboard: arrows move one week, Enter opens it", async ({ page }) => {
  const scene = await open(page, "Lecture notes");
  const slider = scene.getByRole("slider", { name: /Pick a week/ });
  await slider.focus();
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await page.keyboard.press("ArrowLeft");
  await expect(scene.locator(".art-weeks-when")).toHaveText("WEEK 1 OF 3");
  await expect(slider).toHaveAttribute("aria-valuetext", "Week 1 of 3, no notes yet");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(scene.locator(".art-weeks-when")).toHaveText("WEEK 3 OF 3");
  await page.keyboard.press("ArrowUp");
  await expect(scene.locator(".art-weeks-when")).toHaveText("WEEK 2 OF 3");
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/p/${id}/lecture-notes/2$`));
});

test("no snapping: scrolling stops exactly where the user stops, anywhere in the Layers tab", async ({ page }) => {
  await page.goto(`/p/${id}?tab=layers`);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => [...document.querySelectorAll("*")].some((e) => getComputedStyle(e).scrollSnapType !== "none"))).toBe(false);
  // wheel down (through the smooth scroller, as a person would) into the weeks, stop, and nothing moves on its own
  await page.mouse.move(200, 450);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 130);
  await page.waitForTimeout(1500); // let the smooth scroll come to rest
  const stopped = await page.evaluate(() => scrollY);
  expect(stopped).toBeGreaterThan(100);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => scrollY)).toBe(stopped);
  // and from a jump, anywhere through the weeks
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (const f of [0.3, 0.55, 0.8]) {
    const y = Math.round(height * f) - 137;
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(1200);
    expect(Math.round(await page.evaluate(() => scrollY))).toBe(y);
  }
});

test("each scene beside the weeks fills exactly the space below the header in its own tab, and nothing pinned", async ({ page }) => {
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, sceneId] of [["Let’s talk!", "ov-talk-h"], ["Lecture notes", "ov-weeks-h"], ["The exam room", "ov-exam-h"], ["Note to Self", "ov-note-h"]] as const) {
      await page.goto(`/p/${id}?tab=${TAB[name]}`);
      await page.waitForLoadState("networkidle");
      const head = await page.locator(".ov-head").evaluate((e) => e.getBoundingClientRect().bottom);
      const s = await page.locator("main.ov-main section.ov-free").evaluateAll((els) =>
        els.map((e) => ({ id: e.getAttribute("aria-labelledby"), top: e.getBoundingClientRect().top + scrollY, height: e.getBoundingClientRect().height, position: getComputedStyle(e.querySelector(".ov-free-stage") as HTMLElement).position })),
      );
      expect(s.map((x) => x.id)).toEqual([sceneId]);
      expect(s[0].position, sceneId).toBe("static");
      expect(Math.round(s[0].top), `${sceneId} starts right below the header`).toBe(Math.round(head));
      expect(Math.round(s[0].height), `${sceneId} at ${w}x${h}`).toBe(Math.round(h - head));
    }
  }
});

test("the header never has a background, at the top of the page or scrolled; the Layers content fades out below it instead", async ({ page }) => {
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  const head = page.locator(".ov-head");
  const look = () =>
    head.evaluate((el) => {
      const s = getComputedStyle(el);
      const before = getComputedStyle(el, "::before");
      const main = getComputedStyle(document.querySelector(".ov-tabbed > .ov-main")!);
      return { bg: s.backgroundColor, image: s.backgroundImage, border: s.borderBottomWidth, shadow: s.boxShadow, filter: s.backdropFilter, before: before.content, bar: getComputedStyle(el.querySelector(".ov-bar-top")!, "::before").display, mask: main.maskImage };
    });
  for (const y of [0, 600]) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(300);
    const l = await look();
    expect(l.bg, `at ${y}`).toBe("rgba(0, 0, 0, 0)");
    expect(l.image).toBe("none");
    expect(l.border).toBe("0px");
    expect(l.shadow).toBe("none");
    expect(["none", ""]).toContain(l.filter);
    expect(l.before).toBe("none"); // nothing painted behind it
    expect(l.bar).toBe("none"); // the top bar has no background of its own inside the header
    expect(l.mask).toContain("gradient"); // the content carries the fade, once, on the whole scrolling area
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  // every scene's text starts below the bar and its tabs
  const tabsBottom = await page.locator(".ov-tabs").evaluate((el) => el.getBoundingClientRect().bottom);
  for (const name of ["Let’s talk!", "Lecture notes", "The exam room", "Note to Self"]) {
    const scene = await open(page, name);
    expect((await box(scene.locator(".ov-kicker"))).y).toBeGreaterThan(tabsBottom);
  }
});

test("a scene fades in and rises a little as its tab opens; on a fresh load it is simply there; under reduced motion it only fades", async ({ page }) => {
  const watch = () =>
    page.evaluate(() => {
      const w = window as unknown as { __rev: [string | undefined, number, number][] };
      w.__rev = [];
      new MutationObserver((ms) =>
        ms.forEach((m) => {
          const el = m.target as HTMLElement;
          if (el.matches(".ov-free")) w.__rev.push([el.dataset.reveal, Number(getComputedStyle(el).opacity), new DOMMatrix(getComputedStyle(el).transform).f]);
        }),
      ).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-reveal"] });
    });
  const seen = () => page.evaluate(() => (window as unknown as { __rev: [string | undefined, number, number][] }).__rev);
  const scene = page.locator('[aria-labelledby="ov-exam-h"]');
  const style = () => scene.evaluate((el) => ({ opacity: Number(getComputedStyle(el).opacity), y: new DOMMatrix(getComputedStyle(el).transform).f }));

  await page.goto(`/p/${id}?tab=layers`);
  await page.waitForLoadState("networkidle");
  await watch();
  await page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /^Exam room/ }).click();
  await expect.poll(async () => (await style()).opacity).toBe(1);
  expect((await style()).y).toBe(0);
  const steps = await seen();
  expect(steps.map((x) => x[0])).toEqual(["armed", "shown"]);
  expect(steps[0][1]).toBe(0); // it starts hidden
  expect(steps[0][2]).toBeGreaterThan(10); // and a little low

  // a fresh load of the tab: there at once, nothing to wait for
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await style()).toEqual({ opacity: 1, y: 0 });
  expect(await scene.getAttribute("data-reveal")).toBeNull();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/p/${id}?tab=layers`);
  await page.waitForLoadState("networkidle");
  await watch();
  await page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /^Exam room/ }).click();
  await expect.poll(async () => (await style()).opacity).toBe(1);
  expect((await seen()).every((x) => x[2] === 0)).toBe(true); // it only fades
});

test("Note to Self: the notebook shows one written line per layer saved; seen lines are drawn at once, a new one is written by the hero", async ({ page, request }) => {
  const send = async (layer: string) => {
    const r = await request.post(`/api/layers/${layer}/submit`, { data: { text: "This layer, in my own words, for the review." } });
    const { thread } = (await r.json()) as { thread: { latestWritebackId: string } };
    await request.post(`/api/layers/${layer}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" } });
  };
  // nothing saved: a blank page, the hero at the top of the margin
  let scene = await open(page, "Note to Self");
  await expect(scene.locator(".art-nb-line")).toHaveCount(0);
  await expect(scene.locator(".art-nb-rule")).toHaveCount(layers.length);
  await expect(scene.locator(".hero")).toHaveCount(1);

  await send(layers[0]);
  await send(layers[1]);
  // this browser has seen one line before: line 1 is drawn at once, line 2 is written while you watch
  await page.addInitScript((p) => localStorage.setItem(`margin:note-lines-seen:${p}`, "1"), id);
  scene = await open(page, "Note to Self");
  await expect(scene.locator(".art-nb-line")).toHaveCount(2);
  await expect(scene.locator(".ov-free-status")).toHaveText(`2/${layers.length} layers saved`);
  const fill = (i: number) => scene.locator(`.art-nb-line[data-line="${i}"]`).evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(await fill(0)).toBe(1);
  expect(await fill(1)).toBeLessThan(1);
  await expect.poll(() => fill(1), { timeout: 12000 }).toBe(1);
  // and it remembers: the next visit draws both at once
  await expect.poll(() => page.evaluate((p) => localStorage.getItem(`margin:note-lines-seen:${p}`), id)).toBe("2");
  const again = await page.context().newPage();
  await again.goto(`/p/${id}`);
  await again.waitForLoadState("networkidle");
  const s2 = again.getByRole("region", { name: "Note to Self" });
  await s2.evaluate((el: HTMLElement) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY));
  await again.waitForTimeout(400);
  expect(await s2.locator('.art-nb-line[data-line="1"]').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBe(1);
  await again.close();
});

test("reduced motion: the hero stands still and every line is already drawn", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const name of ["Let’s talk!", "Note to Self", "The exam room"]) {
    const scene = await open(page, name);
    const a = await heroAt(scene);
    await page.waitForTimeout(900);
    expect(await heroAt(scene), name).toBe(a);
  }
  const exam = await open(page, "The exam room");
  for (const m of await exam.locator(".art-paper-writing").evaluateAll((els) => els.map((el) => new DOMMatrix(getComputedStyle(el).transform).a))) expect(m).toBe(1);
  const note = await open(page, "Note to Self");
  for (const m of await note.locator(".art-nb-line").evaluateAll((els) => els.map((el) => new DOMMatrix(getComputedStyle(el).transform).a))) expect(m).toBe(1);
  await expect(note.locator(".hero-dot").first()).toHaveCSS("animation-name", "none");
});

test("on a phone the scenes stack: the illustration sits under the text, nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Let’s talk!", "Lecture notes"]) {
    const scene = await open(page, name);
    const text = await box(scene.locator(".ov-free-text"));
    const art = await box(scene.locator(".ov-free-art"));
    expect(art.y).toBeGreaterThan(text.y + text.height - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  }
});

test("the old Weekly notes address still works: it lands on Lecture notes, the same week", async ({ page }) => {
  await page.goto(`/p/${id}/weeks`);
  await expect(page).toHaveURL(new RegExp(`/p/${id}/lecture-notes$`));
  await expect(page.getByRole("heading", { name: "Lecture notes" })).toBeVisible();
  await page.goto(`/p/${id}/weeks/2`);
  await expect(page).toHaveURL(new RegExp(`/p/${id}/lecture-notes/2$`));
  await expect(page).toHaveTitle(/Lecture notes/);
});
