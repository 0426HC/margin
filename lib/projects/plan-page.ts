/** What the one review screen shows besides the plan: the files, what the import couldn't do or find, and a one-line summary. */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { courseWeekCount } from "@/lib/weeks/count";
import { getCourseMapNote } from "./course-import";
import { COURSE_TYPES } from "./file-kinds";
import { listCourseFiles, type CourseFileRow } from "./relabel";

export interface PlanExtras {
  /** Nothing says how many weeks the course runs, so Margin asks. */
  askWeekCount: boolean;
  files: CourseFileRow[];
  /** "12 files: 5 weeks of lectures and readings, a syllabus, 2 optional readings, 1 exam file, your notes for 1 week." Copies are not counted. */
  summary: string;
  weekCount: number | null;
  /** How many files Claude marked "check this". */
  check: number;
  /** Files with no type yet (Claude's answer couldn't be used, or the student hasn't labelled them). */
  unlabelled: number;
  /** Why Claude's answer couldn't be used, when it couldn't. */
  failed: string | null;
  /** Syllabus readings Claude couldn't find among the files. */
  missingReadings: { week: number | null; reading: string }[];
  /** How many files the syllabus doesn't mention. */
  notInSyllabus: number;
  /** What the final check noticed about the course as a whole, and the breaks between weeks, in plain lines. */
  review: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function getPlanExtras(db: Db, projectId: string): PlanExtras {
  const files = listCourseFiles(db, projectId);
  const rows = db.select().from(s.files).where(and(eq(s.files.projectId, projectId), eq(s.files.status, "done"))).all();
  const weekCount = courseWeekCount(db, projectId);
  const note = getCourseMapNote(db, projectId);

  const course = files.filter((f) => f.type !== null && COURSE_TYPES.includes(f.type));
  const weeks = new Set(course.map((f) => f.week).filter((w) => w !== null)).size;
  const bits: string[] = [];
  if (course.length) bits.push(weeks ? `${plural(weeks, "week")} of lectures and readings` : plural(course.length, "lecture or reading", "lectures and readings"));
  const n = (t: CourseFileRow["type"]) => files.filter((f) => f.type === t).length;
  if (n("syllabus")) bits.push(n("syllabus") === 1 ? "the syllabus" : `${n("syllabus")} syllabus files`);
  if (n("optional")) bits.push(plural(n("optional"), "optional reading"));
  if (n("exam")) bits.push(plural(n("exam"), "exam file"));
  const noteWeeks = new Set(files.filter((f) => f.type === "my-notes").map((f) => f.week)).size;
  if (n("my-notes")) bits.push(`your notes for ${plural(noteWeeks, "week")}`);
  const unlabelled = n(null);
  if (unlabelled) bits.push(`${plural(unlabelled, "file")} not labelled yet`);
  const copies = rows.filter((f) => f.category === "duplicate").length;
  const summary = `${plural(files.length, "file")}${bits.length ? `: ${bits.join(", ")}` : ""}.${copies ? ` ${copies === 1 ? "One file was an exact copy of another and is" : `${copies} files were exact copies of others and are`} used once.` : ""}`;
  const present = new Set(files.map((f) => f.id));
  return {
    askWeekCount: !weekCount,
    files,
    summary,
    weekCount,
    check: files.filter((f) => f.check).length,
    unlabelled,
    failed: note.failed,
    missingReadings: note.missingReadings,
    notInSyllabus: note.notInSyllabus.filter((id) => present.has(id)).length,
    review: [
      ...note.breaks.map((b) => `${b.title}${b.date ? ` (${b.date})` : ""} sits ${b.afterWeek ? `between week ${b.afterWeek} and week ${b.afterWeek + 1}` : "before week 1"}. It is a break, not a week of its own.`),
      ...note.review,
    ],
  };
}
