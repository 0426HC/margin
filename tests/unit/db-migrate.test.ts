// @vitest-environment node
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// A database made before this round (migrations up to 0014, no exam_versions) must be brought up to date by the app itself: when it is
// opened, when the server starts, and when a migration is added while a dev server keeps running. Temporary folders only.
const REAL = path.join(process.cwd(), "lib", "db", "migrations");
const LAST_OLD = "0014_agent_requests";

/** A copy of the migrations folder as it was before this round. */
function oldMigrations(dir: string) {
  const out = path.join(dir, "lib", "db", "migrations");
  fs.cpSync(REAL, out, { recursive: true });
  const journalFile = path.join(out, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { entries: { idx: number; tag: string }[] };
  const keep = journal.entries.findIndex((e) => e.tag === LAST_OLD) + 1;
  for (const e of journal.entries.slice(keep)) {
    fs.rmSync(path.join(out, `${e.tag}.sql`), { force: true });
    fs.rmSync(path.join(out, "meta", `${String(e.idx).padStart(4, "0")}_snapshot.json`), { force: true });
  }
  journal.entries = journal.entries.slice(0, keep);
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  return out;
}

/** A database from before this round, with a project and a set-up exam in it. */
function oldDatabase(file: string, migrationsFolder: string) {
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  const now = Date.now();
  sqlite.prepare("insert into projects (id, name, created_at) values (?, ?, ?)").run("p1", "Old course", now);
  sqlite.prepare("insert into exams (id, project_id, kind, title, summary, confirmed, created_at) values (?, ?, 'final', 'Final', ?, 1, ?)").run("e1", "p1", JSON.stringify({ title: "Final" }), now);
  sqlite.close();
}

const tables = (file: string) => {
  const db = new Database(file, { readonly: true });
  const names = db.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name);
  const exam = db.prepare("select * from exams").all().map((r) => { const { id, title, version } = r as { id: string; title: string; version?: number }; return { id, title, version }; });
  db.close();
  return { names, exam };
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "margin-migrate-"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { __marginDb?: unknown }).__marginDb;
  delete (globalThis as { __marginJournal?: unknown }).__marginJournal;
});

describe("the database migrates itself", () => {
  it("the old database really is old: no exam_versions table, no version column", () => {
    const dir = tmp();
    oldDatabase(path.join(dir, "margin.db"), oldMigrations(dir));
    const { names } = tables(path.join(dir, "margin.db"));
    expect(names).toContain("exams");
    expect(names).not.toContain("exam_versions");
  });

  it("opening it brings it up to date and keeps what was there", async () => {
    const dir = tmp();
    const file = path.join(dir, "margin.db");
    oldDatabase(file, oldMigrations(dir));
    const { openDb } = await import("@/lib/db/client");
    openDb(file).sqlite.close();
    const { names, exam } = tables(file);
    expect(names).toContain("exam_versions");
    expect(exam).toEqual([{ id: "e1", title: "Final", version: 1 }]);
  });

  it("the server migrates it when it starts (instrumentation), before any page asks for it", async () => {
    const dir = tmp();
    oldDatabase(path.join(dir, "margin.db"), oldMigrations(dir));
    vi.stubEnv("MARGIN_DATA_DIR", dir);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("@/instrumentation");
    await register();
    expect(tables(path.join(dir, "margin.db")).names).toContain("exam_versions");
  });

  it("a dev server that keeps running picks up a migration added after it started", async () => {
    const dir = tmp();
    const data = path.join(dir, "data");
    fs.mkdirSync(data);
    const folder = oldMigrations(dir);
    oldDatabase(path.join(data, "margin.db"), folder);
    vi.stubEnv("MARGIN_DATA_DIR", data);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir); // the app finds its migrations under the working directory
    const { getDb } = await import("@/lib/db/client");
    getDb(); // the server opens the database: still nothing new to apply
    expect(tables(path.join(data, "margin.db")).names).not.toContain("exam_versions");
    // an update lands this round's migration while the server keeps running
    fs.cpSync(REAL, folder, { recursive: true });
    fs.utimesSync(path.join(folder, "meta", "_journal.json"), new Date(), new Date(Date.now() + 5000));
    getDb(); // the next request
    expect(tables(path.join(data, "margin.db")).names).toContain("exam_versions");
    cwd.mockRestore();
  });
});
