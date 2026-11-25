import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pol326, writeCourse } from "../fixtures/courses";
import { dbAll } from "./helpers";

// The finishing round's full check: every screen of a POL326-style course and the demo, in both modes (normal and lock in), each from a
// fresh tab, with no console errors and no page errors. Run it on the production
// build with E2E_PROD=1. Fake engine, throwaway data folder.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let pol = "";
let demo = "";
let layerId = "";
let examId = "";

test.beforeAll(async ({ browser, request }) => {
  demo = ((await (await request.post("/api/demo")).json()) as { id: string }).id;
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("margin:lock-in-hint-seen", "1"));
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(writeCourse(fs.mkdtempSync(path.join(os.tmpdir(), "margin-audit-")), "POL326", await pol326()));
  await expect(page.getByRole("status")).toHaveText("15 of 15 read", { timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/setup$/);
  pol = page.url().match(/\/p\/([^/]+)\//)![1];
  await expect(page.locator(".m-paper").getByRole("region", { name: /^Week 1 · / })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Looks good" }).first().click();
  await page.waitForURL(new RegExp(`/p/${pol}$`));
  await page.close();
  layerId = dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? order by p.position, l.position limit 1", pol)[0].id;
  examId = dbAll<{ id: string }>("select id from exams where project_id = ? limit 1", demo)[0]?.id ?? "";
});

test.afterAll(async ({ request }) => {
  if (pol) await request.delete(`/api/projects/${pol}`);
});

async function fresh(browser: Browser, mode: "normal" | "lock-in") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((m) => {
    localStorage.setItem("margin:mode", m);
    localStorage.setItem("margin:lock-in-hint-seen", "1");
    localStorage.setItem("margin:weeks-hint-seen", "1");
  }, mode);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} @ ${page.url()}`));
  page.on("pageerror", (e) => errors.push(`${String(e)} @ ${page.url()}`));
  return { page, errors, close: () => context.close() };
}

const settle = async (page: Page) => page.waitForTimeout(2600); // after the entrances (the home greeting takes about two seconds)

for (const mode of ["normal", "lock-in"] as const) {
  test(`every screen, ${mode}: fresh loads, no console errors`, async ({ browser }) => {
    const { page, errors, close } = await fresh(browser, mode);
    const go = async (url: string, name: string, ready: (p: Page) => Promise<void>) => {
      await page.goto(url);
      await ready(page);
      await settle(page);
    };

    await go("/", "home", async (p) => expect(p.getByRole("button", { name: /POL326/ }).first()).toBeVisible());
    await go("/new", "new-project", async (p) => expect(p.getByRole("heading", { name: "New project" })).toBeVisible());
    await go(`/p/${pol}`, "overview-layers", async (p) => expect(p.getByText(/Week 1 · Introduction/).first()).toBeVisible());
    for (const tab of ["talk", "lecture-notes", "exam", "notes"] as const) {
      await go(`/p/${pol}?tab=${tab}`, `overview-${tab}`, async (p) => expect(p.locator("main, .ov").first()).toBeVisible());
    }
    await go(`/p/${pol}/l/${layerId}`, "layer", async (p) => expect(p.getByRole("tab", { name: "Explained" })).toBeVisible({ timeout: 30_000 }));
    await page.getByRole("tab", { name: "Source" }).click();
    await settle(page);
    await go(`/p/${pol}/notes`, "note-to-self", async (p) => expect(p.locator("body")).toBeVisible());
    await go(`/p/${pol}/talk`, "lets-talk", async (p) => expect(p.getByRole("tab", { name: "Chat" }).first()).toBeVisible());
    await go(`/p/${pol}/lecture-notes`, "lecture-notes", async (p) => expect(p.locator("body")).toBeVisible());
    await go(`/p/${pol}/lecture-notes/2`, "lecture-notes-week-2", async (p) => expect(p.getByText("Hamilton wants energy in the executive")).toBeVisible());
    await go(`/p/${pol}/exam`, "exam-room-pol326", async (p) => expect(p.locator("body")).toBeVisible());
    await go(`/p/${pol}/files`, "files", async (p) => expect(p.getByRole("heading", { name: "Files, weeks and types" })).toBeVisible());
    await go(`/p/${pol}/week/1/synthesis`, "synthesis", async (p) => expect(p.getByRole("heading", { name: /synthesis/ }).first()).toBeVisible());

    // the demo's exam room, with Update exam details open
    await go(`/p/${demo}/exam`, "exam-room-demo", async (p) => expect(p.locator("body")).toBeVisible());
    const update = page.getByRole("button", { name: "Update exam details" });
    if (examId && (await update.count())) {
      await update.first().click();
      await settle(page);
      await page.keyboard.press("Escape");
    }

    // a back link from a section page returns to the course
    await page.goto(`/p/${pol}/talk`);
    await page.getByRole("link", { name: /^Back to / }).click();
    await page.waitForURL(new RegExp(`/p/${pol}(\\?|$)`));

    expect(errors).toEqual([]);
    await close();
  });
}

// The focus timer and the stopwatch are driven end to end in lock-in.spec.ts (start, typed length, pause, resume, stop, time up).
