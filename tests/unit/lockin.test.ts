import { describe, expect, it } from "vitest";
import { projectOf } from "@/components/lockin/HeldUpdates";
import { updateLines, waitingLabel } from "@/lib/lockin/held";
import { examLine, noteLine, rowStatus, shortDate, talkLine, upNext, weeksLine } from "@/lib/lockin/plain";

describe("held agent updates", () => {
  it("counts one line per kind of work, and each document on its own", () => {
    const lines = updateLines([
      { id: "a", agent: "librarian", kind: "collect-sources" },
      { id: "b", agent: "librarian", kind: "collect-sources" },
      { id: "c", agent: "explainer", kind: "make-document" },
      { id: "d", agent: "explainer", kind: "make-document" },
    ]);
    expect(lines.map((t) => t.id)).toEqual(["b", "c", "d"]);
  });
  it("says how many are waiting, and nothing when none are", () => {
    expect(waitingLabel(0)).toBeNull();
    expect(waitingLabel(1)).toBe("1 update waiting");
    expect(waitingLabel(2)).toBe("2 updates waiting");
  });
  it("reads the project from the page's address", () => {
    expect(projectOf("/p/abc123/l/x")).toBe("abc123");
    expect(projectOf("/p/abc123")).toBe("abc123");
    expect(projectOf("/")).toBeNull();
    expect(projectOf("/new")).toBeNull();
  });
});

describe("the plain overview's words", () => {
  it("gives every layer a status word", () => {
    expect(rowStatus({ state: "saved" })).toBe("saved");
    expect(rowStatus({ state: "not_saved", started: true })).toBe("in-progress");
    expect(rowStatus({ state: "not_saved" })).toBe("not-started");
  });
  it("Up next uses the project card's line", () => {
    expect(upNext({ layerId: "l1", title: "The problem of faction" })).toEqual({ line: "Continue: The problem of faction", layerId: "l1" });
    expect(upNext(null).layerId).toBeNull();
  });
  it("gives each place a one-line status", () => {
    expect(noteLine(4, 11)).toBe("4/11 saved");
    expect(talkLine({ asked: 0, sources: 0 })).toBe("Nothing asked yet");
    expect(talkLine({ asked: 1, sources: 3 })).toBe("1 question · 3 sources");
    expect(weeksLine([{ hasNotes: true }, { hasNotes: false }, { hasNotes: false }], 2)).toBe("Week 2 of 3 · 1 with notes");
    expect(examLine([], null)).toBe("No exam sheet yet");
    expect(examLine([{ title: "Final exam" }], "December 14")).toBe("Final · Dec 14");
    expect(examLine([{ title: "Midterm" }], null)).toBe("Midterm");
    expect(shortDate("Thursday, October 9")).toBe("Thursday, Oct 9");
  });
});
