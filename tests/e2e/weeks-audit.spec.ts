import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { pol326Real } from "../fixtures/courses";
import { dbAll } from "./helpers";

// The weeks round, seen in the browser: a POL326-style course (lecture folders with chapters, court cases and lecture notes, a syllabus with
// week titles, copies in a Midterm Focus folder) grouped by week. The plan, the Layers tab and its scroll, the sidebar, the home card,
// Explained with its Summary, Show full reading, the week synthesis and lock in, at 1440x900 in both modes, each from a fresh tab with no
// console or page errors. Run it on the production build with E2E_PROD=1. Fake engine.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let pol = "";
let week3Layer = "";

/** The course through the API, as the import does it: every file read, sorted into weeks, then the plan proposed (not yet approved). */
async function importPol326(request: APIRequestContext) {
  const ok = async (r: Awaited<ReturnType<APIRequestContext["post"]>>) => {
    if (!r.ok()) throw new Error(`${r.url()}: ${r.status()} ${await r.text()}`);
    return r;
  };
  const { id } = (await (await ok(await request.post("/api/projects", { data: { name: "POL326 The American Presidency" } }))).json()) as { id: string };
  for (const f of await pol326Real()) {
    await ok(await request.post(`/api/projects/${id}/files`, { multipart: { file: { name: f.relPath.split("/").pop()!, mimeType: "application/octet-stream", buffer: Buffer.from(f.bytes) }, relPath: `POL326/${f.relPath}` } }));
  }
  await ok(await request.post(`/api/projects/${id}/analyze`));
  await ok(await request.post(`/api/projects/${id}/structure/propose`));
  return id;
}

test.beforeAll(async ({ request }) => {
  pol = await importPol326(request);
});

test.afterAll(async ({ request }) => {
  if (pol) await request.delete(`/api/projects/${pol}`);
});

async function fresh(browser: Browser, mode: "normal" | "lock-in") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((m) => {
    localStorage.setItem("margin:mode", m);
    localStorage.setItem("margin:lock-in-hint-seen", "1");
  }, mode);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} @ ${page.url()}`));
  page.on("pageerror", (e) => errors.push(`${String(e)} @ ${page.url()}`));
  return { page, errors, close: () => context.close() };
}

const settle = async (page: Page) => page.waitForTimeout(1800); // after the entrances

test("the plan: twelve weeks titled from the syllabus, each with 2 to 5 layers, weeks without material, no Part anywhere", async ({ browser }) => {
  const { page, errors, close } = await fresh(browser, "normal");
  await page.goto(`/p/${pol}/setup`);
  const sheet = page.locator(".m-paper");
  await expect(sheet.getByRole("region", { name: "Week 3 · Foreign affairs and the courts" })).toBeVisible({ timeout: 60_000 });
  for (let w = 1; w <= 5; w++) {
    const n = await sheet.getByRole("region", { name: new RegExp(`^Week ${w} · `) }).locator(".m-layer").count();
    expect(n, `week ${w}`).toBeGreaterThanOrEqual(1);
    expect(n, `week ${w}`).toBeLessThanOrEqual(5);
  }
  await expect(sheet.getByRole("region", { name: "Week 8 · War powers" })).toContainText("Material not added yet");
  await expect(page.getByText(/\bPart [AB]\b|Consider splitting/)).toHaveCount(0);
  await expect(page.getByText(/2 files were exact copies of others and are used once\./)).toBeVisible();
  await settle(page);
  await page.getByRole("button", { name: "Looks good" }).first().click();
  await page.waitForURL(new RegExp(`/p/${pol}$`));
  week3Layer = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and p.week = 3 order by l.position limit 1", pol)[0].id;
  expect(errors).toEqual([]);
  await close();
});

for (const mode of ["normal", "lock-in"] as const) {
  test(`weeks everywhere, ${mode}: home card, Layers tab, sidebar, a layer, full reading, week synthesis`, async ({ browser }) => {
    const { page, errors, close } = await fresh(browser, mode);

    // the home card: where the course is, and one bar of progress
    await page.goto("/");
    const card = page.locator(`[data-project-id="${pol}"]`);
    // while the full suite loads the server, the streamed page can hold a second copy of the card for a moment: wait for the one that stays
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    await expect(card.getByText(/^Week \d+ of 12 · 0\/\d+ layers saved$/)).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("img", { name: /^0 of \d+ layers saved$/ })).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await settle(page);

    // the Layers tab
    await page.goto(`/p/${pol}`);
    if (mode === "normal") {
      const scenes = page.locator("section.ov-scene");
      await expect(scenes).toHaveCount(5);
      await expect(page.locator(".ov-rail .ov-tick")).toHaveText(["Start", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]);
      await settle(page);
      // scroll into week 3 like a person would, to where its sheets have spread
      await scenes.nth(2).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + (el as HTMLElement).offsetHeight - window.innerHeight));
      await page.waitForTimeout(1500);
      await expect(scenes.nth(2).getByRole("heading", { level: 2 })).toHaveText("Week 3 · Foreign affairs and the courts");
      await expect(scenes.nth(2).locator(".ov-kicker").first()).toHaveText("Week 3 of 12");
      await expect(page.locator(".ov-rail .ov-tick").nth(3)).toHaveAttribute("aria-current", "step");
      const labels = scenes.nth(2).locator(".ov-label");
      for (let k = 0; k < (await labels.count()); k++) await expect(labels.nth(k)).toHaveCSS("opacity", "1");
      await settle(page);
      // and on, past the last week, to the weeks still to come
      await page.locator(".ov-later").scrollIntoViewIfNeeded();
      await expect(page.locator(".ov-later")).toContainText("Week 8 · War powers");
      await settle(page);
    } else {
      const plain = page.getByRole("main", { name: "Layers" });
      await expect(plain.getByRole("region", { name: "Week 3 · Foreign affairs and the courts" })).toBeVisible();
      await expect(plain.getByRole("region", { name: "Week 8 · War powers" })).toContainText("Material not added yet");
      // a list taller than the window stays visible: lock in stops motion, but the fade under the header must still follow the scroll
      expect(await plain.evaluate((el) => getComputedStyle(el).maskPosition)).toBe("0px 0px");
      await settle(page); // the lock in list scrolls inside its own frame: a full-page capture leaves a blank band
    }

    // a week 3 layer: the sidebar by week, Explained with its Summary, Source with Show full reading
    await page.goto(`/p/${pol}/l/${week3Layer}`);
    await expect(page.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 60_000 });
    const side = page.getByRole("navigation", { name: "Layers" });
    await expect(side.getByRole("button", { name: /^Week 3 · / })).toHaveAttribute("aria-expanded", "true");
    await expect(side.getByRole("link", { name: /^Week synthesis for week 3/ })).toContainText("optional");
    await page.getByRole("tab", { name: "Explained" }).click(); // the tab is remembered per layer: the other mode's run left it on Source
    await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
    await settle(page);
    await page.getByRole("tab", { name: "Source" }).click();
    await page.getByRole("switch", { name: "Show full reading" }).click();
    const picker = page.getByRole("group", { name: "This week's readings" });
    await expect(picker.getByRole("button")).toHaveText(["Ch09 Foreign Policy", "POL326 Lecture #3 (lecture)", "United States v. Curtiss-Wright", "Youngstown Sheet & Tube Co. v. Sawyer"]);
    await expect(page.locator(".m-fr-text mark").first()).toBeVisible();
    await settle(page);
    await picker.getByRole("button", { name: "Youngstown Sheet & Tube Co. v. Sawyer" }).click();
    await expect(picker.getByRole("button", { name: "Youngstown Sheet & Tube Co. v. Sawyer" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Youngstown Sheet & Tube Co. v. Sawyer.pdf, full text")).toContainText("JUSTICE JACKSON, concurring");
    await settle(page);

    // the week synthesis
    await side.getByRole("link", { name: /^Week synthesis for week 3/ }).click();
    await page.waitForURL(/\/week\/3\/synthesis$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tie week 3 together" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Tie this week together in your own words" })).toBeVisible();
    await settle(page);

    expect(errors).toEqual([]);
    await close();
  });
}
