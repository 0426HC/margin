import { describe, expect, it } from "vitest";
import { currentWeek, readSyllabusDate } from "@/lib/weeks/current";

const week = (n: number, date: string | null, hasNotes = false) => ({ week: n, date, hasNotes });
const nov15 = new Date(2026, 10, 15);

describe("the current week", () => {
  it("reads syllabus dates as written", () => {
    expect(readSyllabusDate("Oct 29", nov15)?.toDateString()).toBe(new Date(2026, 9, 29).toDateString());
    expect(readSyllabusDate("October 29", nov15)?.getMonth()).toBe(9);
    expect(readSyllabusDate("29 October", nov15)?.getDate()).toBe(29);
    expect(readSyllabusDate("10/29", nov15)?.getMonth()).toBe(9);
    expect(readSyllabusDate("after the break", nov15)).toBeNull();
    // in November, a September date is this autumn and a May date is next spring
    expect(readSyllabusDate("Sep 8", nov15)?.getFullYear()).toBe(2026);
    expect(readSyllabusDate("May 2", nov15)?.getFullYear()).toBe(2027);
  });
  it("is the last week whose date has passed", () => {
    const weeks = [week(1, "Sep 8"), week(2, "Sep 15"), week(7, "Oct 29"), week(8, "Nov 19")];
    expect(currentWeek(weeks, nov15)).toBe(7);
  });
  it("without dates, is the latest week with notes, else week 1", () => {
    expect(currentWeek([week(1, null), week(2, null, true), week(3, null)], nov15)).toBe(2);
    expect(currentWeek([week(1, null), week(2, null)], nov15)).toBe(1);
    expect(currentWeek([], nov15)).toBe(1);
  });
});
