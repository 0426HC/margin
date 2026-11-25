// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { cannedJson } from "@/lib/ai/canned";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { listTasks, markSeen } from "@/lib/agents/tasks";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getNotepad, saveNotepad, searchBlocks, noteBlocksSchema } from "@/lib/talk/notepad";
import { talk } from "@/lib/talk/service";
import { collectTalkSources, getSources, hasUnread } from "@/lib/talk/sources";
import { makeApprovedProject } from "./helpers/course";

let db: Db;
let projectId: string;

beforeEach(async () => {
  db = openDb(":memory:").db;
  projectId = (await makeApprovedProject(db)).id;
});

const drain = async (g: AsyncGenerator<unknown>) => {
  for await (const c of g) void c;
};
const chat = (word: string) => drain(talk(db, new FakeEngine({ text: "It is about this. [x.pdf, p. 1]" }), projectId, `tell me about ${word}`));
const wordIn = (n: number) => db.select().from(s.passages).all()[n].text.split(/\s+/).find((w) => /^kw\d+q$/.test(w))!;
const librarian = (json: (r: never) => unknown = cannedJson as never) => new FakeEngine({ json });

describe("the Librarian's sources", () => {
  it("does nothing, and makes no engine call, when there is no conversation to read", async () => {
    const e = librarian();
    expect(await collectTalkSources(db, e, projectId)).toEqual({ added: 0, topics: [], skipped: "nothing-new" });
    expect(e.calls).toHaveLength(0);
    expect(listTasks(db, projectId).running).toEqual([]);
  });

  it("collects verbatim passages with file and page, grouped by topic", async () => {
    await chat(wordIn(3));
    const r = await collectTalkSources(db, librarian(), projectId);
    expect(r.added).toBeGreaterThan(0);
    const groups = getSources(db, projectId);
    expect(groups.map((g) => g.topic)).toEqual(r.topics);
    for (const src of groups.flatMap((g) => g.sources)) {
      const stored = db.select().from(s.passages).all().find((p) => p.id === src.passageId)!;
      expect(src.text).toBe(stored.text); // copied by code, character for character
      expect(src.page).toBe(stored.page);
      expect(src.file).toMatch(/\.\w+$/);
    }
  });

  it("never copies text the model wrote: only the passage numbers it chose are used, and unknown numbers are dropped", async () => {
    await chat(wordIn(3));
    await collectTalkSources(db, librarian(() => ({ topics: [{ topic: "Invented", passages: [9999, 1] }] }) as never), projectId);
    const all = getSources(db, projectId).flatMap((g) => g.sources);
    expect(all).toHaveLength(1);
    const stored = db.select().from(s.passages).all().find((p) => p.id === all[0].passageId)!;
    expect(all[0].text).toBe(stored.text);
  });

  it("never collects a passage twice, even when a later conversation brings it up again", async () => {
    await chat(wordIn(3));
    await collectTalkSources(db, librarian(), projectId);
    const first = getSources(db, projectId).flatMap((g) => g.sources).map((x) => x.passageId);
    await chat(wordIn(3)); // the same subject again
    await collectTalkSources(db, librarian(), projectId);
    const second = getSources(db, projectId).flatMap((g) => g.sources).map((x) => x.passageId);
    expect(new Set(second).size).toBe(second.length);
    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("the candidates sent to the model never include a passage that is already collected", async () => {
    await chat(wordIn(3));
    await collectTalkSources(db, librarian(), projectId);
    const have = new Set(getSources(db, projectId).flatMap((g) => g.sources).map((x) => x.text));
    await chat(wordIn(3));
    const e = librarian();
    await collectTalkSources(db, e, projectId);
    for (const t of have) expect(e.calls[0]?.prompt ?? "").not.toContain(t);
  });

  it("reads only what is new: the conversation is read once, and a second run does nothing until there is more", async () => {
    await chat(wordIn(3));
    expect(hasUnread(db, projectId)).toBe(true);
    await collectTalkSources(db, librarian(), projectId);
    expect(hasUnread(db, projectId)).toBe(false);
    const e = librarian();
    expect((await collectTalkSources(db, e, projectId)).skipped).toBe("nothing-new");
    expect(e.calls).toHaveLength(0);
    await chat(wordIn(20));
    expect(hasUnread(db, projectId)).toBe(true);
  });

  it("reuses an existing topic name instead of making a near-duplicate", async () => {
    await chat(wordIn(3));
    await collectTalkSources(db, librarian(() => ({ topics: [{ topic: "Faction", passages: [1] }] }) as never), projectId);
    await chat(wordIn(30));
    await collectTalkSources(db, librarian(() => ({ topics: [{ topic: "faction", passages: [1] }] }) as never), projectId);
    expect(getSources(db, projectId).map((g) => g.topic)).toEqual(["Faction"]);
  });

  it("shows the Librarian busy while it works and a result in 'While you were away' when it finishes", async () => {
    await chat(wordIn(3));
    let during: ReturnType<typeof listTasks> | null = null;
    const e = librarian(((r: never) => {
      during = listTasks(db, projectId);
      return cannedJson(r);
    }) as never);
    await collectTalkSources(db, e, projectId);
    expect(during!.running.map((t) => t.agent)).toEqual(["librarian"]);
    const after = listTasks(db, projectId);
    expect(after.running).toEqual([]);
    expect(after.unseen).toHaveLength(1);
    expect(after.unseen[0].result).toMatch(/^Collected \d+ sources? on /);
    markSeen(db, projectId);
    expect(listTasks(db, projectId).unseen).toEqual([]);
  });

  it("a failed run is not busy forever, leaves the conversation unread, and does not appear as finished work", async () => {
    await chat(wordIn(3));
    await expect(collectTalkSources(db, librarian(() => ({ nope: 1 }) as never), projectId)).rejects.toThrow();
    const t = listTasks(db, projectId);
    expect(t.running).toEqual([]);
    expect(t.unseen).toEqual([]);
    expect(hasUnread(db, projectId)).toBe(true);
    expect(getSources(db, projectId)).toEqual([]);
  });

  it("a task left running by a stopped server is shown as failed, not busy", () => {
    db.insert(s.agentTasks).values({ id: "t1", projectId, agent: "librarian", kind: "find-sources", summary: "x", createdAt: Date.now() - 20 * 60_000 }).run();
    expect(listTasks(db, projectId).running).toEqual([]);
  });
});

describe("the notepad", () => {
  it("is empty at first, and saves one page per project (the latest wins)", () => {
    expect(getNotepad(db, projectId)).toEqual({ blocks: [], updatedAt: null });
    saveNotepad(db, projectId, [{ type: "heading", text: "Week 1" }]);
    saveNotepad(db, projectId, [{ type: "heading", text: "Week 1" }, { type: "bullet", text: "faction" }]);
    expect(getNotepad(db, projectId).blocks).toHaveLength(2);
    expect(db.select().from(s.talkNotepad).all()).toHaveLength(1);
  });

  it("keeps structure and text only: anything but heading, paragraph and bullet is refused", () => {
    expect(noteBlocksSchema.safeParse([{ type: "html", text: "<script>" }]).success).toBe(false);
    expect(noteBlocksSchema.safeParse([{ type: "paragraph", text: "<b>x</b>" }]).success).toBe(true); // it is just text; it is never rendered as markup
  });

  it("search finds blocks that contain every word, ignoring case", () => {
    const blocks = [
      { type: "heading" as const, text: "Madison on Faction" },
      { type: "bullet" as const, text: "a large republic dilutes faction" },
      { type: "paragraph" as const, text: "Nothing here." },
    ];
    expect(searchBlocks(blocks, "FACTION").map((m) => m.index)).toEqual([0, 1]);
    expect(searchBlocks(blocks, "large faction").map((m) => m.index)).toEqual([1]);
    expect(searchBlocks(blocks, "   ")).toEqual([]);
  });
});
