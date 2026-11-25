import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbAll, dbCount, fillProject, layerIdsOf, leftovers, seedProject, storedFilesOf, targetsOf } from "./helpers";

// Deleting data for good: a project, chat messages, a whole conversation, collected sources and a Note to Self entry. Every test checks the
// real database file and the stored files, not just the screen, and that another project is exactly as it was. Fake engine, throwaway data folder.
const SHOTS = process.env.SHOTS_DIR ?? null;
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : Promise.resolve(undefined));

test.describe.configure({ mode: "serial" });

/** A second project that none of these deletes may touch, with its own data in every place. */
let keeper = { id: "", layers: [] as string[] };
const keeperState = () => ({ rows: leftovers(targetsOf(keeper.id).all), files: storedFilesOf(keeper.id) });

test.beforeAll(async ({ request, browser }) => {
  const id = await seedProject(request, "Keeper Course");
  const page = await browser.newPage();
  keeper = { id, layers: await fillProject(request, page, id) };
  await page.close();
});

test.afterAll(async ({ request }) => {
  expect((await request.delete(`/api/projects/${keeper.id}`)).ok()).toBe(true); // the other specs start from the data they expect
  expect(leftovers(targetsOf(keeper.id).all)).toEqual({});
  expect(storedFilesOf(keeper.id)).toBeNull();
});

const tile = (page: Page, id: string) => page.locator(`[data-project-id="${id}"]`);

test("delete a project from its card: a quiet menu, a styled confirm, and nothing left behind", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let nativeDialogs = 0;
  page.on("dialog", (d) => {
    nativeDialogs++;
    void d.dismiss();
  });

  const id = await seedProject(request, "Doomed Course");
  const probe = await page.context().newPage();
  const layers = await fillProject(request, probe, id);
  await probe.close();
  const ids = targetsOf(id).all;
  expect(layers.length).toBeGreaterThan(0);
  // it really holds data in every kind of place, and has files on disk
  const before = leftovers(ids);
  for (const t of ["files", "passages", "units", "parts", "layers", "writebacks", "layer_messages", "note_saves", "quick_notes", "talk_messages", "talk_notepad", "week_notes", "exams", "exam_sets", "exam_attempts", "agent_requests", "talk_sources", "ui_state"]) expect(before[t], t).toBeGreaterThan(0);
  expect(storedFilesOf(id)!.length).toBeGreaterThan(0);
  const kept = keeperState();

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = tile(page, id);
  await card.scrollIntoViewIfNeeded();
  const more = card.getByRole("button", { name: "More actions for Doomed Course" });
  await expect(more).toHaveCSS("opacity", "0"); // quiet until the card is hovered or focused
  await card.hover();
  await expect(more).toHaveCSS("opacity", "1");

  await more.click();
  await shot(page, "delete-menu.png");
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete “Doomed Course”?" });
  await expect(dialog).toBeVisible();
  for (const part of ["permanently removes", "files", "layers", "write-ups", "Note to Self", "chats", "notepad", "sources", "cannot be undone"]) await expect(dialog).toContainText(part);
  await shot(page, "delete-project-dialog.png");

  // Cancel (the default focus) deletes nothing
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(leftovers(ids)).toEqual(before);
  expect(storedFilesOf(id)).not.toBeNull();

  // Delete it
  await card.hover();
  await more.click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  await page.getByRole("dialog", { name: "Delete “Doomed Course”?" }).getByRole("button", { name: "Delete project" }).click();

  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(tile(page, keeper.id)).toHaveCount(1);

  expect(leftovers(ids)).toEqual({}); // not one row, in any table, belongs to it any more
  expect(storedFilesOf(id)).toBeNull(); // and its files are gone from disk
  expect(dbCount("select count(*) from passages_fts_docsize")).toBe(dbCount("select count(*) from passages"));
  expect(keeperState()).toEqual(kept); // the other project is exactly as it was
  expect(dbCount("select count(*) from projects where id = ?", id)).toBe(0);
  expect(nativeDialogs).toBe(0); // never a browser pop-up
  expect(errors).toEqual([]);
});

test("the menu and the dialog work from the keyboard alone, and Escape changes nothing", async ({ page, request }) => {
  const id = await seedProject(request, "Keyboard Course");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const more = tile(page, id).getByRole("button", { name: "More actions for Keyboard Course" });
  await more.focus();
  await expect(more).toHaveCSS("opacity", "1"); // focus reveals it
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "Delete project" });
  await expect(item).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
  await expect(more).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete “Keyboard Course”?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Delete project" })).toBeFocused();
  await page.keyboard.press("Tab"); // focus stays inside the dialog
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  expect(dbCount("select count(*) from projects where id = ?", id)).toBe(1);

  // tidy up what this test made
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("delete a project from its overview, and land on Your projects", async ({ page, request }) => {
  const id = await seedProject(request, "Overview Doomed");
  const ids = targetsOf(id).all;
  const kept = keeperState();
  await page.goto(`/p/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "More actions for Overview Doomed" }).click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  await shot(page, "delete-overview-dialog.png");
  await page.getByRole("dialog", { name: "Delete “Overview Doomed”?" }).getByRole("button", { name: "Delete project" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await expect(tile(page, id)).toHaveCount(0);
  expect(leftovers(ids)).toEqual({});
  expect(storedFilesOf(id)).toBeNull();
  expect(keeperState()).toEqual(kept);
  await page.goto(`/p/${id}`); // opening the deleted project again finds nothing
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.getByRole("button", { name: /^More actions for/ })).toHaveCount(0);
});

test("the demo project can be deleted too, and opened again afterwards as a fresh copy", async ({ page, request }) => {
  const first = (await (await request.post("/api/demo")).json()) as { id: string };
  // the student does some work in the demo, which a delete must take with it
  const layers = await fillProject(request, page, first.id);
  expect(layers.length).toBeGreaterThan(0);
  const ids = targetsOf(first.id).all;
  expect(leftovers(ids).note_saves).toBeGreaterThan(0);
  const kept = keeperState();

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Open the demo course" })).toHaveCount(0); // it is open already
  await tile(page, first.id).hover();
  await tile(page, first.id).getByRole("button", { name: /^More actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  const dialog = page.getByRole("dialog", { name: /^Delete “The Federalist Papers”\?/ });
  await expect(dialog).toContainText("The demo course can be opened again from Your projects, as a fresh copy without your work.");
  await dialog.getByRole("button", { name: "Delete project" }).click();

  await expect(tile(page, first.id)).toHaveCount(0);
  expect(leftovers(ids)).toEqual({});
  expect(dbCount("select count(*) from projects where is_demo = 1")).toBe(0);
  expect(keeperState()).toEqual(kept);

  // the offer to open it is back, and opening it gives a fresh copy with none of the earlier work
  await page.getByRole("button", { name: "Open the demo course" }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  const again = page.url().split("/p/")[1];
  expect(again).not.toBe(first.id);
  expect(leftovers(targetsOf(again).all).note_saves).toBeUndefined();
  expect(leftovers(targetsOf(again).all).talk_messages).toBeUndefined();

  // leave the data as it was found: other specs expect the demo to be offered until they open it themselves
  expect((await request.delete(`/api/projects/${again}`)).ok()).toBe(true);
  expect(dbCount("select count(*) from projects where is_demo = 1")).toBe(0);
});

test("Let's talk!: delete one message (a question goes with its answer), then clear the whole conversation", async ({ page, request }) => {
  const id = await seedProject(request, "Chat Course");
  const kept = keeperState();
  const rows = (channel: string) => dbCount("select count(*) from talk_messages where project_id = ? and channel = ?", id, channel);
  await request.post(`/api/projects/${id}/talk`, { data: { question: "A question in the notebook chat", topic: "A passage", channel: "note" } });

  await page.goto(`/p/${id}/talk`);
  await page.waitForLoadState("networkidle");
  const chat = page.getByRole("complementary", { name: "Let's talk!" });
  const ask = async (q: string, answers: number, saved: number) => {
    await chat.getByRole("textbox", { name: "Ask your professor" }).fill(q);
    await chat.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(chat.locator('.m-msg[data-kind="tutor"]')).toHaveCount(answers, { timeout: 15_000 });
    await expect(chat.getByRole("log")).toHaveAttribute("aria-busy", "false");
    await expect.poll(() => rows("talk")).toBe(saved); // wait until the reply is saved, not just shown
  };
  await ask("What is faction?", 1, 2);
  await ask("And how is it controlled?", 2, 4);
  expect(rows("talk")).toBe(4);

  // the delete control on a message is quiet until the message is hovered
  const first = chat.locator('.m-msg[data-kind="user"]').first();
  const del = first.getByRole("button", { name: "Delete this question and its answer" });
  await expect(del).toHaveCSS("opacity", "0");
  await first.hover();
  await expect(del).toHaveCSS("opacity", "1");
  await shot(page, "delete-chat-message.png");
  await del.click();
  await expect(chat.locator(".m-msg")).toHaveCount(2); // that question and its answer are gone, the other pair stays
  await expect(chat.getByText("What is faction?")).toHaveCount(0);
  expect(rows("talk")).toBe(2);
  expect(dbCount("select count(*) from talk_messages where project_id = ? and content = ?", id, "What is faction?")).toBe(0);

  // deleting an answer deletes only the answer
  const answer = chat.locator('.m-msg[data-kind="tutor"]').first();
  await answer.hover();
  await answer.getByRole("button", { name: "Delete this answer" }).click();
  await expect(chat.locator(".m-msg")).toHaveCount(1);
  expect(rows("talk")).toBe(1);

  // clear the conversation, with a styled confirm that can be cancelled
  await ask("One more question", 1, 3); // the earlier unanswered question is still in the thread
  await chat.getByRole("button", { name: "Clear conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear this conversation?" });
  await expect(dialog).toContainText("permanently deletes every message in Let’s talk!");
  await shot(page, "clear-conversation-dialog.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(rows("talk")).toBeGreaterThan(0);
  await chat.getByRole("button", { name: "Clear conversation" }).click();
  await page.getByRole("dialog", { name: "Clear this conversation?" }).getByRole("button", { name: "Clear conversation" }).click();
  await expect(chat.locator(".m-msg")).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Clear conversation" })).toHaveCount(0);
  expect(rows("talk")).toBe(0);
  expect(rows("note")).toBe(2); // the Note to Self chat is a separate conversation and is untouched
  expect(keeperState()).toEqual(kept);

  // it is gone for good: a reload shows an empty conversation
  await page.reload();
  await expect(chat.getByText("Ask a question about any reading")).toBeVisible();
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("the Note to Self chat has the same deletes, and they touch only that chat", async ({ page, request }) => {
  const id = await seedProject(request, "Notes Chat Course");
  const kept = keeperState();
  const rows = (channel: string) => dbCount("select count(*) from talk_messages where project_id = ? and channel = ?", id, channel);
  await request.post(`/api/projects/${id}/talk`, { data: { question: "A Let's talk! question" } });
  await request.post(`/api/projects/${id}/talk`, { data: { question: "First notebook question", topic: "A passage", channel: "note" } });
  await request.post(`/api/projects/${id}/talk`, { data: { question: "Second notebook question", channel: "note" } });
  // one saved write-up, so the notebook has an entry
  const layers = await (async () => {
    const probe = await page.context().newPage();
    const l = await layerIdsOf(probe, id);
    await probe.close();
    return l;
  })();
  const { thread } = (await (await request.post(`/api/layers/${layers[0]}/submit`, { data: { text: "My own words." } })).json()) as { thread: { latestWritebackId: string } };
  await request.post(`/api/layers/${layers[0]}/save`, { data: { writebackId: thread.latestWritebackId, choice: "own" } });
  expect(rows("note")).toBe(4);

  await page.goto(`/p/${id}/notes`);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 8000 });
  const chat = page.getByRole("complementary", { name: "Ask about your notes" });
  await expect(chat.locator(".m-msg")).toHaveCount(4);
  await shot(page, "delete-notes-chat.png");

  const q = chat.locator('.m-msg[data-kind="user"]').first();
  await q.hover();
  await q.getByRole("button", { name: "Delete this question and its answer" }).click();
  await expect(chat.locator(".m-msg")).toHaveCount(2);
  expect(rows("note")).toBe(2);
  expect(rows("talk")).toBe(2); // Let's talk! is not touched

  await chat.getByRole("button", { name: "Clear conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear this conversation?" });
  await expect(dialog).toContainText("the Note to Self chat");
  await expect(dialog).toContainText("Your notes and write-ups are not touched.");
  await dialog.getByRole("button", { name: "Clear conversation" }).click();
  await expect(chat.locator(".m-msg")).toHaveCount(0);
  expect(rows("note")).toBe(0);
  expect(rows("talk")).toBe(2);
  expect(dbCount("select count(*) from note_saves where target_id = ?", layers[0])).toBe(1); // the saved write-up is still there
  expect(keeperState()).toEqual(kept);
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("delete a collected source: just that one, and only from its own project", async ({ page, request }) => {
  const id = await seedProject(request, "Sources Course");
  const probe = await page.context().newPage();
  await fillProject(request, probe, id);
  await probe.close();
  const kept = keeperState();
  const rows = () => dbCount("select count(*) from talk_sources where project_id = ?", id);
  const total = rows();
  expect(total).toBeGreaterThan(1);

  await page.goto(`/p/${id}/talk?tab=sources`);
  await page.waitForLoadState("networkidle");
  const sources = page.locator(".m-tt-topic .m-q");
  await expect(sources).toHaveCount(total);
  const text = (await sources.first().locator("> p").innerText()).slice(0, 60);
  const del = sources.first().getByRole("button", { name: /^Delete this source/ });
  await expect(del).toHaveCSS("opacity", "0");
  await sources.first().hover();
  await expect(del).toHaveCSS("opacity", "1");
  await shot(page, "delete-source.png");
  await del.click();

  await expect(sources).toHaveCount(total - 1);
  expect(rows()).toBe(total - 1);
  expect(dbCount("select count(*) from talk_sources where project_id = ? and substr(text, 1, 60) = ?", id, text)).toBe(0);
  expect(keeperState()).toEqual(kept);
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("delete a saved Note to Self entry in the notebook: Undo brings it back; let go, it leaves with its quick notes, and the layer stays", async ({ page, request }) => {
  const id = await seedProject(request, "Entry Course");
  const probe = await page.context().newPage();
  const layers = await fillProject(request, probe, id);
  await probe.close();
  const kept = keeperState();
  const first = layers[0];
  const title = dbAll<{ title: string }>("select title from layers where id = ?", first)[0].title;
  const count = (table: string, col = "target_id") => dbCount(`select count(*) from ${table} where ${col} = ?`, first);
  expect(count("note_saves")).toBe(1);
  expect(count("quick_notes")).toBe(1);

  await page.goto(`/p/${id}/notes`);
  await expect(page.locator(".nb-cover")).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator(".nb-entry")).toHaveCount(2);
  const entry = page.locator(".nb-entry").first();
  const del = entry.getByRole("button", { name: `Delete the write-up of “${title}” from Note to Self` });
  await expect(del).toHaveCSS("opacity", "0"); // quiet until the pointer or focus is in that write-up
  await entry.hover();
  await expect(del).toHaveCSS("opacity", "1");
  await expect(page.locator(".nb-entry").nth(1).locator(".nb-remove")).toHaveCSS("opacity", "0"); // only that one's
  await shot(page, "remove-note-entry.png");

  // Delete, then Undo: nothing changed
  await del.click();
  const gone = page.getByRole("status").filter({ hasText: `Deleted “${title}”.` });
  await expect(gone).toBeVisible();
  await expect(page.locator(".nb-entry")).toHaveCount(1);
  await shot(page, "remove-note-entry-undo.png");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".nb-entry")).toHaveCount(2);
  await page.waitForTimeout(7000); // longer than Undo is offered
  expect(count("note_saves")).toBe(1);

  // Delete and let it go
  await entry.hover();
  await del.click();
  await expect.poll(() => count("note_saves"), { timeout: 10_000 }).toBe(0);
  await expect(page.locator(".nb-entry")).toHaveCount(1);
  expect(dbCount("select count(*) from quick_notes where project_id = ? and target_id = ?", id, first)).toBe(0);
  expect(dbCount("select count(*) from writebacks where target_id = ?", first)).toBeGreaterThan(0); // the layer's write-ups remain
  expect(dbCount("select count(*) from layer_messages where target_id = ?", first)).toBeGreaterThan(0); // and its chat
  expect(dbCount("select count(*) from note_saves where target_id = ?", layers[1])).toBe(1); // the other entry is still there
  expect(keeperState()).toEqual(kept);

  // a reload shows the same, and the layer itself still opens, asking about the review again
  await page.reload();
  await expect(page.locator(".nb-entry")).toHaveCount(1);
  await page.goto(`/p/${id}/l/${first}`);
  await expect(page.getByText("Send to Note to Self?").first()).toBeVisible();
  expect((await request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("tests run on a throwaway data folder, never the real .data", () => {
  const dir = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "margin-e2e-data");
  expect(path.resolve(dir)).not.toBe(path.resolve(process.cwd(), ".data"));
  expect(fs.existsSync(path.join(dir, "margin.db"))).toBe(true);
});
