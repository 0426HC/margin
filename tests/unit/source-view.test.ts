// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { demoSeedSchema, importDemoSeed } from "@/lib/demo/seed";
import { bestPassage, getSourcePage, markBlock } from "@/lib/layers/source-view";
import { makeApprovedProject } from "./helpers/course";

describe("markBlock", () => {
  it("splits around the verbatim pieces and never changes the text", () => {
    const text = "Before the claim. The cited words sit here. After it.";
    const parts = markBlock(text, ["The cited words sit here."]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["The cited words sit here."]);
  });
  it("marks nothing when a piece is not in the block", () => {
    expect(markBlock("Some text.", ["other"])).toEqual([{ text: "Some text.", hit: false }]);
  });
});

describe("bestPassage", () => {
  const cs = [{ text: "faction and the danger of majorities" }, { text: "the army and navy of the union" }];
  it("picks the passage sharing most words with what was said", () => {
    expect(bestPassage(cs, "The navy matters for the union")).toBe(cs[1]);
  });
  it("falls back to the first with nothing to go on", () => {
    expect(bestPassage(cs)).toBe(cs[0]);
  });
});

describe("getSourcePage", () => {
  let db: Db;
  let projectId: string;
  beforeEach(async () => {
    db = openDb(":memory:").db;
    projectId = (await makeApprovedProject(db)).id;
  });

  it("returns the page's blocks verbatim with one passage marked", () => {
    const p = db.select().from(s.passages).get()!;
    const file = db.select().from(s.files).all().find((f) => f.id === p.fileId)!;
    const view = getSourcePage(db, projectId, file.name, p.page, p.text)!;
    expect(view.file).toBe(file.name);
    const original = file.parsed!.filter((b) => b.page === p.page).map((b) => b.text);
    expect(view.blocks.map((b) => b.parts.map((x) => x.text).join(""))).toEqual(original);
    expect(view.blocks.some((b) => b.parts.some((x) => x.hit))).toBe(true);
  });

  it("is null for a file or page that isn't there, and for another project's file", () => {
    const f = db.select().from(s.files).get()!;
    expect(getSourcePage(db, projectId, "nope.pdf", 1)).toBeNull();
    expect(getSourcePage(db, projectId, f.name, 9999)).toBeNull();
    expect(getSourcePage(db, "other", f.name, 1)).toBeNull();
  });
});

describe("the demo course", () => {
  // The demo keeps no separate parsed copy of its files, so the viewer must read pages from the stored sections.
  it("opens every Source quote on its own page with a passage marked", () => {
    const db = openDb(":memory:").db;
    const id = importDemoSeed(db, demoSeedSchema.parse(JSON.parse(fs.readFileSync("demo/seed.json", "utf8"))));
    const quotes = db.select().from(s.layerContent).all().flatMap((c) => c.source);
    expect(quotes.length).toBeGreaterThan(10);
    for (const q of quotes) {
      const view = getSourcePage(db, id, q.file, q.page, q.text);
      expect(view, `${q.file} p. ${q.page}`).not.toBeNull();
      expect(view!.blocks.some((b) => b.parts.some((p) => p.hit))).toBe(true);
    }
  });
});
