import type { FileRole } from "@/lib/import/types";

export type ExamKind = "midterm" | "final" | "exam";

/** What to call a new exam in the exam room: Midterm or Final when the sheet's name or first words say so, otherwise Exam. */
export function examKindOf(name: string, text = ""): ExamKind {
  const source = `${name.replace(/\.[a-z0-9]{1,5}$/i, "")} ${text.slice(0, 400)}`;
  return /mid-?term/i.test(source) ? "midterm" : /(?<![a-z])final/i.test(source) ? "final" : "exam";
}

/** The role to use for a stored file: Lecture, Reading or exam material. Files without one (the syllabus, notes) read as Reading. */
export const effectiveRole = (f: { role?: FileRole | null }): FileRole => f.role ?? "reading";
