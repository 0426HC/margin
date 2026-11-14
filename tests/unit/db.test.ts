// @vitest-environment node
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { searchPassages } from "@/lib/db/search";
import * as s from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function seeded() {
  const { db, sqlite } = openDb(":memory:");
  db.insert(s.projects).values({ id: "p1", name: "Demo" }).run();
  db.insert(s.units).values({ id: "u1", projectId: "p1", title: "Week 1", position: 0 }).run();
  db.insert(s.files).values({ id: "f1", projectId: "p1", unitId: "u1", name: "fed10.txt", relPath: "fed10.txt" }).run();
  db.insert(s.sections).values({ id: "s1", projectId: "p1", unitId: "u1", fileId: "f1", position: 0, title: "t", pageStart: 1, pageEnd: 3, wordCount: 10, original: [] }).run();
  const rows = [
    ["a", 1, "A faction is a number of citizens united by a common impulse of passion."],
    ["b", 2, "The causes of faction cannot be removed; only its effects can be controlled."],
    ["c", 3, "A republic differs from a pure democracy in the scheme of representation."],
  ] as const;
  rows.forEach(([id, page, text], i) =>
    db.insert(s.passages).values({ id, projectId: "p1", fileId: "f1", sectionId: "s1", page, ordinal: i, text }).run(),
  );
  return { db, sqlite };
}

describe("migrations", () => {
  it("apply to an empty database and are safe to run again on the same file", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-db-")), "m.db");
    const first = openDb(file);
    first.db.insert(s.projects).values({ id: "keep", name: "Keep me" }).run();
    first.sqlite.close();
    const second = openDb(file); // runs the migrator again
    const tables = second.sqlite.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["projects", "files", "units", "sections", "passages", "passages_fts", "ui_state", "parts", "layers", "layer_passages", "layer_content", "writebacks", "layer_messages", "note_saves"]));
    expect(tables).not.toEqual(expect.arrayContaining(["chats"]));
    for (const retired of ["chats", "notes", "questions", "reviews"]) expect(tables).not.toContain(retired);
    expect(second.db.select().from(s.projects).all().map((p) => p.id)).toEqual(["keep"]);
  });
});

describe("migrating a Phase 2 database", () => {
  it("adds the layer tables, drops the retired section tables, and keeps projects and their text", async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { default: Database } = await import("better-sqlite3");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const src = path.join(process.cwd(), "lib/db/migrations");
    const old = fs.mkdtempSync(path.join(os.tmpdir(), "margin-mig-"));
    fs.mkdirSync(path.join(old, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(src, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 2); // what a Phase 2 install had
    fs.writeFileSync(path.join(old, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(old, `${e.tag}.sql`));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "margin-db-")), "old.db");
    const raw = new Database(file);
    raw.pragma("foreign_keys = ON");
    migrate(drizzle(raw), { migrationsFolder: old });
    raw.prepare("insert into projects (id, name, status, is_demo, created_at) values ('p', 'Old course', 'ready', 0, 1)").run();
    raw.prepare("insert into units (id, project_id, title, position, is_overview, created_at) values ('u', 'p', 'Week 1', 0, 0, 1)").run();
    expect((raw.prepare("select name from sqlite_master where name = 'chats'").all() as unknown[]).length).toBe(1);
    raw.close();

    const { db, sqlite } = openDb(file);
    const tables = sqlite.prepare("select name from sqlite_master where type = 'table'").all().map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["parts", "layers", "note_saves"]));
    expect(tables).not.toContain("chats");
    expect(db.select().from(s.projects).all().map((p) => p.name)).toEqual(["Old course"]);
    expect(db.select().from(s.units).all()).toHaveLength(1);
  });
});

describe("searchPassages", () => {
  it("returns the matching passage first, with its file and page", () => {
    const { db } = seeded();
    const hits = searchPassages(db, "p1", "republic democracy representation", 5);
    expect(hits[0]).toMatchObject({ passageId: "c", file: "fed10.txt", page: 3, sectionId: "s1" });
  });

  it("stems words, so 'controlling' finds 'controlled'", () => {
    const { db } = seeded();
    expect(searchPassages(db, "p1", "controlling effects", 5)[0].passageId).toBe("b");
  });

  it.each(['"', "-", "*", "faction:", "AND OR NOT", "(((", "a-b -c", "'; drop table passages; --", ""])("does not throw on %j", (q) => {
    const { db } = seeded();
    expect(() => searchPassages(db, "p1", q, 5)).not.toThrow();
  });

  it("scopes to a section, a unit or an explicit set of passages", () => {
    const { db } = seeded();
    db.insert(s.units).values({ id: "u2", projectId: "p1", title: "Week 2", position: 1 }).run();
    db.insert(s.sections).values({ id: "s2", projectId: "p1", unitId: "u2", fileId: "f1", position: 1, title: "t2", pageStart: 4, pageEnd: 4, wordCount: 5, original: [] }).run();
    db.insert(s.passages).values({ id: "d", projectId: "p1", fileId: "f1", sectionId: "s2", page: 4, ordinal: 0, text: "Faction again, in the second unit." }).run();
    const ids = (scope: Parameters<typeof searchPassages>[4]) => searchPassages(db, "p1", "faction", 10, scope).map((h) => h.passageId).sort();
    expect(ids({})).toEqual(["a", "b", "d"]);
    expect(ids({ sectionId: "s2" })).toEqual(["d"]);
    expect(ids({ unitId: "u1" })).toEqual(["a", "b"]);
    expect(ids({ passageIds: ["b", "d"] })).toEqual(["b", "d"]);
    expect(ids({ passageIds: [] })).toEqual([]);
  });

  it("stays inside the project", () => {
    const { db } = seeded();
    expect(searchPassages(db, "other", "faction", 5)).toEqual([]);
  });

  it("can be limited to one section", () => {
    const { db } = seeded();
    expect(searchPassages(db, "p1", "faction", 5, { sectionId: "nope" })).toEqual([]);
    expect(searchPassages(db, "p1", "faction", 5, { sectionId: "s1" }).length).toBeGreaterThan(0);
  });

  it("drops a passage from the index when it is deleted", () => {
    const { db } = seeded();
    db.delete(s.passages).where(eq(s.passages.id, "c")).run();
    expect(searchPassages(db, "p1", "republic democracy", 5)).toEqual([]);
  });

  it("drops passages from the index when their project is deleted", () => {
    const { db } = seeded();
    db.delete(s.projects).where(eq(s.projects.id, "p1")).run();
    expect(searchPassages(db, "p1", "faction", 5)).toEqual([]);
  });
});
