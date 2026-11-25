import { FORMAT_LABEL, type ExamSection, type ExamSummary } from "./types";

/** One line of "What changes": where, what it was (struck through), what it becomes. `from` is null for something added, `to` for something removed. */
export interface Change {
  label: string;
  from: string | null;
  to: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = (m: number | null) => (m === null ? null : m % 60 === 0 ? plural(m / 60, "hour") : `${m} minutes`);
const list = (xs: string[]) => (xs.length ? xs.join(", ") : null);
const weeks = (ws: number[]) => (ws.length ? `${ws.length === 1 ? "Week" : "Weeks"} ${ws.join(", ")}` : "The whole course");
const marks = (m: number | null) => (m === null ? null : plural(m, "mark"));

/**
 * The part of a sentence that changed, so a long instruction reads as "choice of two questions → choice of three questions" rather than
 * the whole sentence twice. Words the two share at the start are dropped up to the last comma or full stop; a final full stop goes too.
 */
export function changedPart(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const head = a.slice(0, i);
  const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf(". "), head.lastIndexOf("; "));
  const from = cut >= 0 ? cut + 2 : 0;
  const trim = (x: string) => x.slice(from).replace(/\.$/, "").trim();
  return [trim(a), trim(b)];
}

function sectionChanges(a: ExamSection, b: ExamSection): Change[] {
  const out: Change[] = [];
  const name = b.name || a.name;
  if (a.name !== b.name) out.push({ label: "Section name", from: a.name, to: b.name });
  if (a.instructions.trim() !== b.instructions.trim()) {
    if (!a.instructions.trim() || !b.instructions.trim()) out.push({ label: name, from: a.instructions.trim() || null, to: b.instructions.trim() || null });
    else {
      const [from, to] = changedPart(a.instructions.trim(), b.instructions.trim());
      out.push({ label: name, from, to });
    }
  }
  if (a.format !== b.format) out.push({ label: `${name}, question type`, from: FORMAT_LABEL[a.format], to: FORMAT_LABEL[b.format] });
  if (a.count !== b.count) out.push({ label: `${name}, questions`, from: plural(a.count, "question"), to: plural(b.count, "question") });
  if (a.marksEach !== b.marksEach) out.push({ label: `${name}, marks each`, from: marks(a.marksEach), to: marks(b.marksEach) });
  return out;
}

/** Every difference between the exam's details now and the new ones, in the order of the form. */
export function summaryChanges(a: ExamSummary, b: ExamSummary): Change[] {
  const out: Change[] = [];
  const field = (label: string, x: string | null, y: string | null) => {
    if ((x ?? "") !== (y ?? "")) out.push({ label, from: x || null, to: y || null });
  };
  field("Title", a.title, b.title);
  field("Date", a.date, b.date);
  field("Length", minutes(a.lengthMinutes), minutes(b.lengthMinutes));
  field("Total marks", marks(a.totalMarks), marks(b.totalMarks));
  const n = Math.max(a.sections.length, b.sections.length);
  for (let i = 0; i < n; i++) {
    const x = a.sections[i];
    const y = b.sections[i];
    if (x && y) out.push(...sectionChanges(x, y));
    else if (y) out.push({ label: "New section", from: null, to: `${y.name}: ${plural(y.count, `${FORMAT_LABEL[y.format].toLowerCase()} question`)}` });
    else if (x) out.push({ label: "Section removed", from: x.name, to: null });
  }
  if (a.weeks.join() !== b.weeks.join()) out.push({ label: "Weeks it covers", from: weeks(a.weeks), to: weeks(b.weeks) });
  field("Topics", list(a.topics), list(b.topics));
  if (a.markingGuide.trim() !== b.markingGuide.trim()) {
    const [from, to] = a.markingGuide.trim() && b.markingGuide.trim() ? changedPart(a.markingGuide.trim(), b.markingGuide.trim()) : [a.markingGuide.trim(), b.markingGuide.trim()];
    out.push({ label: "Marking guide", from: from || null, to: to || null });
  }
  const added = (x: string[], y: string[]) => y.filter((t) => !x.includes(t));
  for (const [label, x, y] of [
    ["Terms", a.terms, b.terms],
    ["Sample questions", a.sampleQuestions, b.sampleQuestions],
  ] as const) {
    for (const t of added(x, y)) out.push({ label, from: null, to: t });
    for (const t of added(y, x)) out.push({ label, from: t, to: null });
  }
  return out;
}
