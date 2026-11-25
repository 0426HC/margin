import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { deleteProject } from "@/lib/projects/delete";
import { getCondensed, saveCondensed } from "@/lib/talk/condensed";
import { makeApprovedProject } from "./helpers/course";

let db: Db;
let projectId: string;
beforeEach(async () => {
  db = openDb(":memory:").db;
  projectId = (await makeApprovedProject(db)).id;
});

describe("condensed notes", () => {
  it("start empty, save with nothing in Note to Self, and come back in the notebook's data", () => {
    expect(getCondensed(db, projectId)).toBe("");
    expect(getNoteGuide(db, projectId)!.finished).toBe(0);
    expect(saveCondensed(db, projectId, "Union -> safety")).toBe("Union → safety");
    expect(getCondensed(db, projectId)).toBe("Union → safety");
    expect(getNoteGuide(db, projectId)!.condensed).toBe("Union → safety");
    saveCondensed(db, projectId, "Union → safety, and a shorter line");
    expect(getCondensed(db, projectId)).toBe("Union → safety, and a shorter line");
  });

  it("are one page per project, separate from the layer notes", async () => {
    const other = (await makeApprovedProject(db)).id;
    saveCondensed(db, projectId, "mine");
    expect(getCondensed(db, other)).toBe("");
    expect(db.select().from(s.quickNotes).all()).toEqual([]);
  });

  it("an emptied page leaves nothing behind, and deleting the project deletes them", () => {
    saveCondensed(db, projectId, "something");
    saveCondensed(db, projectId, "   ");
    expect(db.select().from(s.uiState).all().filter((r) => r.key === "condensed-notes")).toEqual([]);
    saveCondensed(db, projectId, "again");
    deleteProject(db, projectId);
    expect(db.select().from(s.uiState).all().filter((r) => r.key === "condensed-notes")).toEqual([]);
  });
});
