/** The words on the plain (lock in) overview. Pure, so they are tested without a browser. */

export type RowStatus = "saved" | "in-progress" | "not-started";
export const ROW_WORD: Record<RowStatus, string> = { saved: "Saved", "in-progress": "In progress", "not-started": "Not started" };

export function rowStatus(l: { state: "saved" | "not_saved"; started?: boolean }): RowStatus {
  return l.state === "saved" ? "saved" : l.started ? "in-progress" : "not-started";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Continue: The problem of faction", the same line as the project card; or, with everything saved, where to look back. */
export function upNext(resume: { layerId: string; title: string } | null): { line: string; layerId: string | null } {
  return resume ? { line: `Continue: ${resume.title}`, layerId: resume.layerId } : { line: "Every layer is saved. Your study guide is in Note to Self.", layerId: null };
}

export function noteLine(saved: number, total: number) {
  return `${saved}/${total} saved`;
}

export function talkLine(t: { asked: number; sources: number }) {
  if (!t.asked && !t.sources) return "Nothing asked yet";
  return [plural(t.asked, "question"), plural(t.sources, "source")].join(" · ");
}

export function weeksLine(weeks: { hasNotes: boolean }[], current: number) {
  if (!weeks.length) return "No weeks yet";
  const written = weeks.filter((w) => w.hasNotes).length;
  return `Week ${current} of ${weeks.length} · ${written} with notes`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "December 14" → "Dec 14"; anything it can't read is kept as written. */
export function shortDate(d: string) {
  return d.replace(new RegExp(`\\b(${MONTHS.join("|")})\\b`, "g"), (m) => m.slice(0, 3));
}

/** "Final · Dec 14", from the first exam and what its sheet says. */
export function examLine(exams: { title: string }[], date: string | null | undefined) {
  if (!exams.length) return "No exam sheet yet";
  const name = exams[0].title.replace(/\s+exam$/i, "");
  return [name, date ? shortDate(date) : null].filter(Boolean).join(" · ");
}
