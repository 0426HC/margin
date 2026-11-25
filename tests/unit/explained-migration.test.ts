// @vitest-environment node
/**
 * Migration 0024: layers written with the Key concepts table lose it from what is stored, and are written again in the new shape when next
 * opened (marked stale); the read-only demo keeps its text as it is. Made-up rows only, in an in-memory database.
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

const SQL = fs.readFileSync(path.join(process.cwd(), "lib/db/migrations/0024_explained_without_table.sql"), "utf8");

describe("Explained without the table (migration 0024)", () => {
  it("drops the table and Also mentioned, marks those layers to be written again, and leaves the demo and newer layers alone", () => {
    const { db, sqlite } = openDb(":memory:");
    const now = Date.now();
    for (const [id, demo] of [["p1", false], ["demo", true]] as const) {
      db.insert(s.projects).values({ id, name: id, isDemo: demo, status: "ready", createdAt: now }).run();
      db.insert(s.parts).values({ id: `${id}-w1`, projectId: id, key: "week-1", title: "", week: 1, position: 1, breakdownStatus: "approved" }).run();
    }
    const old = { version: 2, question: "Q?", summary: "S.", sections: [{ question: "A?", blocks: [{ type: "paragraph", text: "T." }] }], concepts: [{ name: "X", meaning: "m", example: "e", why: "w" }], alsoMentioned: [{ name: "Y", note: "n" }], soWhat: "So." };
    const fresh = { version: 2, question: "Q?", summary: "S.", sections: [{ question: "A?", blocks: [{ type: "paragraph", text: "T." }] }], soWhat: "So." };
    const add = (layerId: string, partId: string, explained: object) => {
      db.insert(s.layers).values({ id: layerId, partId, position: 0, title: layerId, bigQuestion: "Q?", contentStatus: "ready", createdAt: now }).run();
      db.insert(s.layerContent).values({ id: `${layerId}-c`, layerId, explained: explained as never, source: [] }).run();
    };
    add("old", "p1-w1", old);
    add("new", "p1-w1", fresh);
    add("demo-layer", "demo-w1", old);
    db.insert(s.uiState).values({ id: "p1:layer-draft:old", projectId: "p1", key: "layer-draft:old", value: { hash: "h", explained: old } }).run();

    for (const statement of SQL.split("--> statement-breakpoint")) sqlite.exec(statement);

    const status = (id: string) => db.select().from(s.layers).where(eq(s.layers.id, id)).get()!.contentStatus;
    const stored = (id: string) => JSON.stringify(db.select().from(s.layerContent).where(eq(s.layerContent.layerId, id)).get()!.explained);
    expect(status("old")).toBe("stale");
    expect(status("new")).toBe("ready");
    expect(status("demo-layer")).toBe("ready");
    for (const id of ["old", "new", "demo-layer"]) expect(stored(id)).not.toMatch(/"concepts"|"alsoMentioned"/);
    expect(stored("old")).toContain('"sections"');
    expect(db.select().from(s.uiState).where(eq(s.uiState.key, "layer-draft:old")).get()).toBeUndefined();
  });
});
