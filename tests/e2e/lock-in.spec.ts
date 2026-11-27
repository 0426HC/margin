import { expect, test, type Browser, type Page } from "@playwright/test";
import { dbAll, dbCount, layerIdsOf, seedProject } from "./helpers";

// Lock in: the switch on every page, the plain overview, layer pages, Graphite, held agent updates, the focus timer and the stopwatch,
// the remembered mode and the one-time hint. Fake engine, throwaway data folder (playwright.config.ts).
test.describe.configure({ mode: "serial" });

let id = "";
let layers: string[] = [];
const titles: string[] = [];

test.beforeAll(async ({ request, browser }) => {
  id = await seedProject(request, "Lock In Course");
  const page = await browser.newPage();
  layers = await layerIdsOf(page, id);
  for (const l of layers.slice(0, 2)) titles.push(dbAll<{ title: string }>("select title from layers where id = ?", l)[0].title);
  await page.close();
});
test.afterAll(async ({ request }) => {
  await request.delete(`/api/projects/${id}`);
});

const lockSwitch = (page: Page) => page.getByRole("switch", { name: /^Lock(ed)? in$/ });
const locked = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute("data-lockin"));

async function lockIn(page: Page) {
  await lockSwitch(page).click();
  await expect(lockSwitch(page)).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(650); // the half-second crossfade
}
async function goOpen(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
/** A brand-new browser context (a new tab, a new visit), with whatever is in its storage. */
async function freshContext(browser: Browser, storage: Record<string, string> = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [{ origin: "http://localhost:" + (process.env.E2E_PORT ?? 3100), localStorage: Object.entries(storage).map(([name, value]) => ({ name, value })) }] },
  });
  return { context, page: await context.newPage() };
}
const rgb = (page: Page, selector: string, prop = "backgroundColor") => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as "color"], prop);

test("the Lock in switch is in the top bar of every page, and stays on across pages until switched off", async ({ page }) => {
  test.setTimeout(120_000);
  const pages = ["/", "/new", `/p/${id}`, `/p/${id}/l/${layers[0]}`, `/p/${id}/week/1/synthesis`, `/p/${id}/talk`, `/p/${id}/notes`, `/p/${id}/lecture-notes`, `/p/${id}/exam`];
  for (const p of pages) {
    await goOpen(page, p);
    await expect(lockSwitch(page), p).toBeVisible();
    await expect(lockSwitch(page), p).toHaveAttribute("aria-checked", "false");
    await expect(lockSwitch(page), p).toHaveText("Lock in");
  }
  // on: "Locked in" with a plum dot, the switch plum
  await goOpen(page, `/p/${id}`);
  await expect(page.getByRole("button", { name: "Update from folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  await lockIn(page);
  await expect(lockSwitch(page)).toHaveText("Locked in");
  await expect(lockSwitch(page).locator(".lk-dot")).toBeVisible();
  expect(await rgb(page, ".lk-switch .lk-track")).toBe("rgb(107, 44, 126)");
  // Update from folder and Add files stay visible in lock in
  await expect(page.getByRole("button", { name: "Update from folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  // no page reload: the same document, the same scroll context
  const marker = await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 42));
  expect(marker).toBe(42);
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(42);
  // across pages: client navigation and full loads alike
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/l\//);
  await expect(lockSwitch(page)).toHaveAttribute("aria-checked", "true");
  for (const p of pages) {
    await goOpen(page, p);
    await expect(lockSwitch(page), p).toHaveAttribute("aria-checked", "true");
    expect(await locked(page), p).toBe(true);
  }
  // off again, and it stays off
  await lockSwitch(page).click();
  await expect(lockSwitch(page)).toHaveAttribute("aria-checked", "false");
  await goOpen(page, "/");
  expect(await locked(page)).toBe(false);
});

test("in lock in the Layers tab is one plain screen: Up next, every layer as a row with its status; the other places are tabs", async ({ page, request }) => {
  // layer 1 saved, layer 2 started (written back, not saved)
  const post = async (url: string, data: unknown) => (await request.post(url, { data })).json();
  const one = (await post(`/api/layers/${layers[0]}/submit`, { text: "My own words about the first layer." })) as { thread: { latestWritebackId: string } };
  await post(`/api/layers/${layers[0]}/save`, { writebackId: one.thread.latestWritebackId, choice: "own" });
  await post(`/api/layers/${layers[1]}/submit`, { text: "A first try at the second layer." });

  await goOpen(page, `/p/${id}`);
  await lockIn(page);
  const plain = page.getByRole("main", { name: "Layers" });
  await expect(plain).toBeVisible();
  // nothing decorative or moving is left
  for (const sel of [".bd", ".hall", ".ov-rail", ".ov-corner", ".ov-main", ".ov-intro"]) await expect(page.locator(sel), sel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave a note for the agents" })).toHaveCount(0);

  // Up next: the same line as the project card ("Continue: ..."), with a Continue button that opens that layer
  const next = plain.getByRole("region", { name: "Up next" });
  await expect(next).toContainText(`Continue: ${titles[1]}`);
  await expect(next.getByRole("link", { name: "Continue", exact: true })).toHaveAttribute("href", `/p/${id}/l/${layers[1]}`);
  await page.goto("/");
  await expect(page.locator(`[data-project-id="${id}"] .ho-resume`).last()).toHaveText(`Continue: ${titles[1]}`);
  await goOpen(page, `/p/${id}`);

  // weeks with counts, layers as rows with a status word
  const week1 = plain.getByRole("region", { name: /^Week 1 · / });
  await expect(week1.getByLabel(/^1 of \d+ layers saved$/)).toBeVisible();
  const rows = plain.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("Saved");
  await expect(rows.nth(1)).toContainText("In progress");
  await expect(rows.nth(2)).toContainText("Not started");
  expect(await rgb(page, '.lk-status[data-state="saved"]', "color")).toBe("rgb(211, 138, 224)");
  await expect(plain.getByRole("region", { name: /^Week 3 · / })).toBeVisible();
  await expect(plain.locator(".lk-row-wk")).toHaveCount(0); // inside a week, no per-layer week labels

  // the places beside the weeks are the course's tabs now, the same in both modes
  const tabs = page.getByRole("navigation", { name: "Course sections" });
  await expect(tabs.getByRole("link")).toHaveText([/^Layers\s*1\/\d+$/, /^Let’s talk!$/, /^Lecture notes\s*wk \d+$/, /^Exam room$/, /^Note to Self$/]);
  await expect(plain.getByRole("navigation", { name: "Beside the weeks" })).toHaveCount(0);

  // a row opens its layer
  await rows.nth(2).getByRole("link").click();
  await page.waitForURL(new RegExp(`/l/${layers[2]}$`));
});

test("layer pages in lock in keep their tabs and sidebar, with no agents corner and a book-width reading column", async ({ page }) => {
  // a week 3 layer: its week has lecture material, so it has all three tabs (a week with neither notes nor lecture material has no Lecture tab)
  const week3 = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and p.week = 3 and l.proposed = 0 order by l.position", id)[0].id;
  await goOpen(page, `/p/${id}/l/${week3}`);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  const wideNormal = await page.locator(".m-row > p").first().evaluate((el) => el.getBoundingClientRect().width);
  await lockIn(page);
  for (const name of ["Explained", "Lecture", "Source"]) await expect(page.getByRole("tab", { name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
  await expect(page.locator(".ov-corner, .wa, .hall, .bd")).toHaveCount(0);
  // about 65 characters a line, centred in the reading area
  const measure = await page.locator(".m-row > p").first().evaluate((p) => {
    const r = document.createRange();
    r.selectNodeContents(p);
    const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    const text = (p.textContent ?? "").length;
    const pane = p.closest(".m-scroll")!.getBoundingClientRect();
    const col = p.closest(".m-reading")!.getBoundingClientRect();
    return { perLine: lines > 1 ? text / lines : null, width: p.getBoundingClientRect().width, left: col.left - pane.left, right: pane.right - col.right };
  });
  expect(measure.width).toBeLessThanOrEqual(wideNormal);
  if (measure.perLine !== null) {
    expect(measure.perLine).toBeGreaterThan(50);
    expect(measure.perLine).toBeLessThan(75);
  }
  expect(Math.abs(measure.left - measure.right)).toBeLessThan(24);
  // no motion on tabs: the switch is instant
  const t = await page.locator(".m-seg-thumb").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(t.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  await lockSwitch(page).click();
});

test("Graphite colours apply only in lock in", async ({ page }) => {
  await goOpen(page, `/p/${id}/l/${layers[0]}`);
  await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 });
  const normal = { desk: await rgb(page, "html"), sheet: await rgb(page, ".m-reading-pane"), ink: await rgb(page, ".m-reading-pane", "color") };
  expect(normal).toEqual({ desk: "rgb(17, 24, 39)", sheet: "rgb(237, 240, 246)", ink: "rgb(19, 27, 45)" });
  await lockIn(page);
  expect(await rgb(page, "html")).toBe("rgb(14, 15, 17)");
  expect(await rgb(page, ".m-reading-pane")).toBe("rgb(27, 29, 33)");
  expect(await rgb(page, ".m-reading-pane", "color")).toBe("rgb(227, 228, 232)");
  expect(await rgb(page, ".m-ws")).toBe("rgb(14, 15, 17)"); // the side panes sit on the desk
  expect(await rgb(page, '.m-seg-btn[aria-selected="true"] .m-seg-thumb')).toBe("rgb(107, 44, 126)");
  await lockSwitch(page).click();
  await page.waitForTimeout(650);
  expect(await rgb(page, "html")).toBe("rgb(17, 24, 39)");
  expect(await rgb(page, ".m-reading-pane")).toBe("rgb(237, 240, 246)");
});

test("agent updates are held while locked in, counted in a quiet pill, and shown when lock in is switched off", async ({ page, request }) => {
  await request.post(`/api/projects/${id}/agent-requests`, { data: { text: "A one-page study guide for week 1" } });
  await expect.poll(() => dbCount("select count(*) from agent_tasks where project_id = ? and status = 'done' and seen = 0", id), { timeout: 20_000 }).toBeGreaterThan(0);

  await goOpen(page, `/p/${id}`);
  const away = page.getByRole("complementary", { name: "While you were away" });
  await expect(away).toBeVisible({ timeout: 10_000 });
  await lockIn(page);
  await expect(away).toHaveCount(0);
  const pill = page.getByRole("status").filter({ hasText: /updates? waiting/ });
  await expect(pill).toHaveText("1 update waiting", { timeout: 10_000 });
  // held on every page, still counted
  await goOpen(page, `/p/${id}/l/${layers[0]}`);
  await expect(pill).toHaveText("1 update waiting", { timeout: 10_000 });
  await expect(away).toHaveCount(0);
  // switched off: shown as usual, and the pill is gone
  await goOpen(page, `/p/${id}`);
  await lockSwitch(page).click();
  await expect(away).toBeVisible({ timeout: 10_000 });
  await expect(away).toContainText("Explainer");
  await expect(pill).toHaveCount(0);
  await away.getByRole("button", { name: "Dismiss" }).click();
});

test("the focus timer: lock in only, a typed length, the last length remembered, pause, resume and stop", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-16T09:00:00") });
  await goOpen(page, `/p/${id}`);
  const pill = page.locator(".lk-timer");
  await expect(pill).toHaveCount(0); // not in normal mode
  await lockIn(page);
  await expect(page.getByRole("button", { name: "Focus timer" })).toBeVisible();
  await page.getByRole("button", { name: "Focus timer" }).click();
  const panel = page.getByRole("dialog", { name: "Focus for how long?" });
  await expect(panel).toBeVisible();
  const minutes = panel.getByRole("spinbutton", { name: "Focus for how long?" });
  // out of range: told what to type, nothing starts
  await minutes.fill("300");
  await panel.getByRole("button", { name: "Start" }).click();
  await expect(panel).toContainText("from 1 to 240");
  await minutes.fill("7");
  await panel.getByRole("button", { name: "Start" }).click();
  await expect(panel).toHaveCount(0);
  await expect(pill.getByRole("timer")).toHaveText("07:00");
  await page.clock.runFor(61_000);
  await expect(pill.getByRole("timer")).toHaveText("05:59");

  // pause: the clock holds, whatever time passes
  await pill.click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(pill).toContainText("Paused");
  await page.clock.runFor(5 * 60_000);
  await expect(pill.getByRole("timer")).toHaveText("05:59");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.clock.runFor(60_000);
  await expect(pill.getByRole("timer")).toHaveText("04:59");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Focus timer" })).toBeVisible();

  // the last length is remembered and filled in
  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(panel).toContainText("Last time: 7 minutes");
  await expect(minutes).toHaveValue("7");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Focus timer" }).click();
  await expect(minutes).toHaveValue("7");
  await page.keyboard.press("Escape");
  await lockSwitch(page).click();
});

test("the countdown stays right while the tab is hidden, and the stopwatch speaks when time is up (Take a break, Another round)", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-16T10:00:00") });
  await goOpen(page, `/p/${id}`);
  await lockIn(page);
  await page.getByRole("button", { name: "Focus timer" }).click();
  await page.getByRole("spinbutton", { name: "Focus for how long?" }).fill("25");
  await page.getByRole("button", { name: "Start" }).click();
  const clock = page.locator(".lk-timer").getByRole("timer");
  await expect(clock).toHaveText("25:00");

  // hidden for ten minutes with no timers running at all (setSystemTime moves the clock without firing any): shown again, it is exact
  const visibility = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await visibility(true);
  await page.clock.setSystemTime(new Date("2026-11-16T10:10:00"));
  await visibility(false);
  await expect(clock).toHaveText("15:00");

  // time up while hidden: the stopwatch's note is there when the tab is shown, bottom left
  await visibility(true);
  await page.clock.setSystemTime(new Date("2026-11-16T10:25:02"));
  await visibility(false);
  const note = page.getByRole("complementary", { name: "Stopwatch" });
  await expect(note).toBeVisible();
  await expect(note).toContainText("Stopwatch");
  await expect(note).toContainText("just now");
  await expect(note).toContainText("25 minutes done. Take 5, or go another round?");
  const box = await note.boundingBox();
  expect(box!.x).toBeLessThan(40);
  expect(box!.y + box!.height).toBeGreaterThan(860);

  // Take a break: a five-minute break, labelled as a break
  await note.getByRole("button", { name: "Take a break" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Break, running" })).toContainText("Break");
  await expect(clock).toHaveText("05:00");
  await page.clock.runFor(5 * 60_000 + 1000);
  await expect(note).toContainText("Break’s over. Ready for another round?");
  await expect(note.getByRole("button", { name: "Take a break" })).toHaveCount(0);

  // Another round: the last length again
  await note.getByRole("button", { name: "Another round" }).click();
  await expect(note).toHaveCount(0);
  await expect(clock).toHaveText("25:00");
  await page.clock.runFor(25 * 60_000 + 1000);
  await expect(note).toContainText("25 minutes done.");
  await note.getByRole("button", { name: "Another round" }).click();
  await expect(clock).toHaveText("25:00");
  // switching lock in off ends the timer: the pill is lock in only
  await lockSwitch(page).click();
  await expect(page.locator(".lk-timer")).toHaveCount(0);
});

test("a fresh visit opens in the mode the student last used, with no question asked", async ({ browser }) => {
  const a = await freshContext(browser, { "margin:mode": "lock-in", "margin:lock-in-hint-seen": "1" });
  await a.page.goto(`/p/${id}`);
  expect(await locked(a.page)).toBe(true); // set before the first paint
  await expect(lockSwitch(a.page)).toHaveAttribute("aria-checked", "true");
  await expect(a.page.getByRole("main", { name: "Layers" })).toBeVisible();
  await expect(a.page.getByRole("dialog")).toHaveCount(0);
  await a.context.close();

  const b = await freshContext(browser, { "margin:mode": "normal", "margin:lock-in-hint-seen": "1" });
  await b.page.goto(`/p/${id}`);
  expect(await locked(b.page)).toBe(false);
  await expect(lockSwitch(b.page)).toHaveAttribute("aria-checked", "false");
  await b.context.close();
});

test("the one-time hint points at the switch the first time, and never again after Got it or using the switch", async ({ browser }) => {
  const hint = (page: Page) => page.getByRole("note", { name: "New: Lock in" });
  const a = await freshContext(browser);
  await a.page.goto("/");
  await expect(hint(a.page)).toBeVisible();
  await expect(hint(a.page)).toContainText("New: Lock in. Turn off the visuals when you need to focus.");
  // it sits under the switch
  const s = (await lockSwitch(a.page).boundingBox())!;
  const h = (await hint(a.page).boundingBox())!;
  expect(h.y).toBeGreaterThan(s.y + s.height);
  expect(Math.abs(h.x + h.width - (s.x + s.width))).toBeLessThan(40);
  await hint(a.page).getByRole("button", { name: "Got it" }).click();
  await expect(hint(a.page)).toHaveCount(0);
  await a.page.reload();
  await a.page.waitForLoadState("networkidle");
  await expect(hint(a.page)).toHaveCount(0);
  await a.page.goto(`/p/${id}`);
  await expect(hint(a.page)).toHaveCount(0);
  await a.context.close();

  // using the switch counts as having seen it
  const b = await freshContext(browser);
  await b.page.goto(`/p/${id}`);
  await expect(hint(b.page)).toBeVisible();
  await lockSwitch(b.page).click();
  await expect(hint(b.page)).toHaveCount(0);
  await lockSwitch(b.page).click();
  await b.page.reload();
  await b.page.waitForLoadState("networkidle");
  await expect(hint(b.page)).toHaveCount(0);
  await b.context.close();
});

test("a fresh tab shows everything on its first load, in both modes, even before scripts run", async ({ browser }) => {
  test.setTimeout(150_000);
  for (const mode of ["normal", "lock-in"] as const) {
    const { context, page } = await freshContext(browser, { "margin:mode": mode, "margin:lock-in-hint-seen": "1" });
    // hold the page's scripts back: what shows is the page as sent
    await context.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => (await new Promise((r) => setTimeout(r, 6000)), route.continue()));
    await page.goto(`/p/${id}`, { waitUntil: "commit" });
    await page.waitForTimeout(2500);
    if (mode === "normal") {
      await expect(page.locator("#ov-course")).toBeVisible();
      await expect(page.locator(".lk-ov")).toBeHidden();
    } else {
      await expect(page.locator(".lk-ov")).toBeVisible();
      await expect(page.locator(".lk-next")).toContainText("Continue:");
      await expect(page.locator(".ov-main")).toBeHidden();
      await expect(page.locator(".bd")).toBeHidden();
    }
    // and once scripts run, it is all still there
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(6500);
    if (mode === "normal") await expect(page.locator("#ov-course")).toBeVisible();
    else await expect(page.getByRole("region", { name: "Up next" })).toBeVisible();
    await context.close();
    // the other pages, in a clean tab (nothing held back), in the same mode
    const next = await freshContext(browser, { "margin:mode": mode, "margin:lock-in-hint-seen": "1" });
    for (const p of ["/", `/p/${id}/l/${layers[0]}`]) {
      await next.page.goto(p);
      await next.page.waitForLoadState("networkidle");
      await expect(lockSwitch(next.page), `${mode} ${p}`).toHaveAttribute("aria-checked", mode === "lock-in" ? "true" : "false");
      if (p === "/") await expect(next.page.getByRole("heading", { name: "Your projects" })).toBeVisible();
    }
    await next.context.close();
  }
});

test("each course uses its own details: a second course's code and name are on the Let's talk! laptop, its weeks in Lecture notes", async ({ page, request }) => {
  test.setTimeout(120_000);
  const other = await seedProject(request, "Rome and the Republic", { courseCode: "HIS210" });
  try {
    await goOpen(page, `/p/${other}?tab=talk`);
    const laptop = page.locator('[aria-labelledby="ov-talk-h"]').locator(".art-scr-course");
    await expect(laptop).toHaveText(/HIS210 · Rome and the Republic/); // the code and the name, each said once
    await expect(page.locator('[aria-labelledby="ov-talk-h"]')).not.toContainText("POL101");
    // the exam desk has no other course's exam beside it
    await goOpen(page, `/p/${other}?tab=exam`);
    await expect(page.locator('[aria-labelledby="ov-exam-h"]')).toBeVisible();
    await expect(page.locator('[aria-labelledby="ov-exam-h"]')).not.toContainText(/Identify and explain|Federalist|December 14/);
    // Lecture notes: this course's weeks
    // the sample folder's "Study notes.docx" is read as the student's own notes and copied into week 2, so exactly one week has notes
    const weeks = dbCount("select count(*) from week_notes where project_id = ?", other);
    expect(weeks).toBe(1);
    await goOpen(page, `/p/${other}?tab=lecture-notes`);
    await expect(page.locator('[aria-labelledby="ov-weeks-h"]')).toContainText(/1 of \d+ weeks have notes/);
    // and the first course still shows its own
    await goOpen(page, `/p/${id}?tab=talk`);
    await expect(page.locator('[aria-labelledby="ov-talk-h"] .art-scr-course')).not.toContainText("HIS210");
  } finally {
    await request.delete(`/api/projects/${other}`);
  }
});
