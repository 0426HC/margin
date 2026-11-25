import { expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");

export function courseFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-e2e-")), "POL101 Federalist Seminar");
  fs.cpSync(SAMPLE, root, { recursive: true });
  return root;
}

/** Import the sample course; Margin proposes the plan with the fake engine; "Looks good" approves it. Returns the project id. */
export async function makeProject(page: Page, { approve = true } = {}) {
  await page.goto("/new");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("folder-input").setInputFiles(courseFolder());
  await expect(page.getByRole("status")).toContainText("read", { timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/p\/[^/]+\/setup$/);
  const projectId = page.url().match(/\/p\/([^/]+)\//)![1];
  // the plan is proposed on its own; one review screen, already filled in
  await expect(page.locator(".m-paper").getByRole("region", { name: /^Week 1 · / })).toBeVisible({ timeout: 30_000 });
  if (approve) {
    await page.getByRole("button", { name: "Looks good" }).first().click();
    await page.waitForURL(new RegExp(`/p/${projectId}$`));
  }
  return projectId;
}

/** A ready project made through the API with the fake engine: upload the sample course, propose each week's layers and approve the plan. */
export async function seedProject(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  { courseCode, beforePropose }: { courseCode?: string; /** Runs after the files are read, before the layers are proposed (e.g. to rename units). */ beforePropose?: (id: string) => Promise<void> } = {},
) {
  const post = async (url: string, init?: Parameters<typeof request.post>[1]) => {
    const r = await request.post(url, init);
    if (!r.ok()) throw new Error(`${url}: ${r.status()} ${await r.text()}`);
    return r;
  };
  const { id } = (await (await post("/api/projects", { data: { name, courseCode } })).json()) as { id: string };
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(SAMPLE)) {
    await post(`/api/projects/${id}/files`, {
      multipart: { file: { name: path.basename(file), mimeType: "application/octet-stream", buffer: fs.readFileSync(file) }, relPath: path.relative(SAMPLE, file) },
    });
  }
  await post(`/api/projects/${id}/analyze`);
  await post(`/api/projects/${id}/finish`);
  if (beforePropose) await beforePropose(id);
  await post(`/api/projects/${id}/structure/propose`);
  await post(`/api/projects/${id}/structure/approve`, { data: {} }); // every Part at once, as "Looks good" does
  return id;
}

/** The project's layer ids in course order, read from the layer list on the Let's talk! screen. */
export async function layerIdsOf(page: Page, projectId: string) {
  // the sidebar opens only the current week, so the full course order comes from the database (week by week, then each week's order)
  await page.goto(`/p/${projectId}/talk`);
  await page.locator('a[href*="/l/"]').first().waitFor();
  return dbAll<{ id: string }>("select l.id from layers l join parts p on p.id = l.part_id where p.project_id = ? and l.proposed = 0 order by p.position, l.position", projectId).map((r) => r.id);
}

/** Every saved write-up on the Note to Self book: the text in its box and the name it is announced with (which layer, which version). */
export const writeUps = (page: Page) =>
  page.locator(".nb-entry > .nb-text").evaluateAll((els) => els.map((e) => ({ label: e.getAttribute("aria-label") ?? "", value: (e as HTMLTextAreaElement).value })));

// ---- looking straight into the e2e database and files folder (a throwaway folder; the same one playwright.config.ts gives the server) ----

export const e2eDataDir = () => process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "margin-e2e-data");

/** Run a read-only query against the e2e database file. */
export function dbAll<T = Record<string, unknown>>(query: string, ...args: unknown[]): T[] {
  const db = new Database(path.join(e2eDataDir(), "margin.db"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare(query).all(...args) as T[];
  } finally {
    db.close();
  }
}
export const dbCount = (query: string, ...args: unknown[]) => Number(Object.values(dbAll<Record<string, number>>(query, ...args)[0])[0]);

/** The ids that belong to a project's layers and weeks: what the write-ups and layer chats are keyed by. */
export function targetsOf(projectId: string) {
  const parts = dbAll<{ id: string }>("select id from parts where project_id = ?", projectId).map((r) => r.id);
  const layers = parts.length ? dbAll<{ id: string }>(`select id from layers where part_id in (${parts.map(() => "?").join(",")})`, ...parts).map((r) => r.id) : [];
  const exams = dbAll<{ id: string }>("select id from exams where project_id = ?", projectId).map((r) => r.id);
  const sets = exams.length ? dbAll<{ id: string }>(`select id from exam_sets where exam_id in (${exams.map(() => "?").join(",")})`, ...exams).map((r) => r.id) : [];
  return { parts, layers, all: [projectId, ...parts, ...layers, ...exams, ...sets] };
}

/**
 * Every table with rows that belong to the project: through its project id, or through the ids of its layers and weeks. An empty result
 * means nothing of the project is left anywhere in the database.
 */
export function leftovers(ids: string[]): Record<string, number> {
  const db = new Database(path.join(e2eDataDir(), "margin.db"), { readonly: true, fileMustExist: true });
  try {
    const out: Record<string, number> = {};
    const tables = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'passages_fts%'").all() as { name: string }[]).map((t) => t.name);
    const marks = ids.map(() => "?").join(",");
    for (const t of tables) {
      const cols = (db.prepare(`pragma table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      const keys = cols.filter((c) => ["project_id", "target_id", "layer_id", "part_id", "exam_id", "set_id"].includes(c));
      if (["projects", "parts", "layers"].includes(t)) keys.push("id");
      let n = 0;
      for (const k of keys) n += (db.prepare(`select count(*) as c from "${t}" where "${k}" in (${marks})`).get(...ids) as { c: number }).c;
      if (n) out[t] = n;
    }
    return out;
  } finally {
    db.close();
  }
}

/** The project's stored upload folder: its file names, or null when the folder is gone. */
export const storedFilesOf = (projectId: string) => {
  const dir = path.join(e2eDataDir(), "files", projectId);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null;
};

/** Put something in every place a project keeps data, through the API with the fake engine. */
export async function fillProject(request: import("@playwright/test").APIRequestContext, page: Page, id: string) {
  const layers = await layerIdsOf(page, id);
  const post = async (url: string, data?: unknown) => {
    const r = await request.post(url, { data });
    if (!r.ok()) throw new Error(`${url}: ${r.status()} ${await r.text()}`);
    return r;
  };
  for (const [i, choice] of (["own", "refined"] as const).entries()) {
    const { thread } = (await (await post(`/api/layers/${layers[i]}/submit`, { text: `My own words about layer ${i + 1}, said plainly.` })).json()) as { thread: { latestWritebackId: string } };
    await post(`/api/layers/${layers[i]}/save`, { writebackId: thread.latestWritebackId, choice });
    const q = await request.put(`/api/projects/${id}/quick-notes`, { data: { targetType: "layer", targetId: layers[i], text: `note ${i + 1} -> done` } });
    if (!q.ok()) throw new Error(`quick-notes: ${q.status()}`);
  }
  await request.put(`/api/projects/${id}/notepad`, { data: { blocks: [{ type: "heading", text: "My notes" }, { type: "bullet", text: "a point" }] } });
  await fillExam(request, id);
  await request.post(`/api/projects/${id}/agent-requests`, { data: { text: "Find the passages about faction" } });
  await request.put(`/api/projects/${id}/weeks/2/notes`, { data: { blocks: [{ type: "paragraph", text: "What the lecture said in week 2" }] } });
  await post(`/api/projects/${id}/talk`, { question: "What do the readings say about faction?" });
  await post(`/api/projects/${id}/talk`, { question: "What is this passage about?", topic: "A highlighted passage", channel: "note" });
  await post(`/api/projects/${id}/sources/find`);
  return layers;
}

/** An exam with its sheet read and confirmed, a practice set and a handed-in attempt, through the API with the fake engine. */
export async function fillExam(request: import("@playwright/test").APIRequestContext, id: string) {
  const sheet = "Midterm exam instructions\n\nTime allowed: 60 minutes. Section A: multiple choice. Section B: essay. Marking guide: marks are awarded for use of the readings.";
  const up = await request.post(`/api/projects/${id}/exams`, { multipart: { file: { name: "Midterm exam instructions.txt", mimeType: "text/plain", buffer: Buffer.from(sheet) } } });
  if (up.status() === 403) return null; // the demo takes no new files, so it has no exam
  if (!up.ok()) throw new Error(`exam sheet: ${up.status()} ${await up.text()}`);
  const { id: examId } = (await up.json()) as { id: string };
  const read = (await (await request.post(`/api/exams/${examId}/read`)).json()) as { summary: unknown };
  await request.put(`/api/exams/${examId}/summary`, { data: { summary: read.summary, confirm: true } });
  const { set } = (await (await request.post(`/api/exams/${examId}/sets`)).json()) as { set: { id: string } };
  const { attempt } = (await (await request.post(`/api/exam-sets/${set.id}/attempts`, { data: { timer: "none" } })).json()) as { attempt: { id: string } };
  await request.post(`/api/exam-attempts/${attempt.id}/hand-in`, { data: { answers: { q1: "0", q4: "A written answer long enough to be marked." } } });
  return examId;
}
