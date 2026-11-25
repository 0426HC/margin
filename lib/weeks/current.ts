import type { WeekSummary } from "./notes";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A syllabus date as written ("Oct 29", "October 29", "29 October", "10/29") as a day this academic year, or null if it can't be read. */
export function readSyllabusDate(text: string, now: Date): Date | null {
  const t = text.toLowerCase();
  let month = -1;
  let day = NaN;
  const named = t.match(/([a-z]{3,})\.?\s+(\d{1,2})\b/) ?? null;
  const dayFirst = t.match(/\b(\d{1,2})\s+([a-z]{3,})/) ?? null;
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\b/) ?? null;
  if (named && MONTHS.includes(named[1].slice(0, 3))) [month, day] = [MONTHS.indexOf(named[1].slice(0, 3)), Number(named[2])];
  else if (dayFirst && MONTHS.includes(dayFirst[2].slice(0, 3))) [month, day] = [MONTHS.indexOf(dayFirst[2].slice(0, 3)), Number(dayFirst[1])];
  else if (numeric) [month, day] = [Number(numeric[1]) - 1, Number(numeric[2])];
  if (month < 0 || month > 11 || !(day >= 1 && day <= 31)) return null;
  const d = new Date(now.getFullYear(), month, day);
  // a course runs within one academic year: the date is the one within half a year of today
  const half = 183 * 864e5;
  if (d.getTime() - now.getTime() > half) d.setFullYear(d.getFullYear() - 1);
  else if (now.getTime() - d.getTime() > half) d.setFullYear(d.getFullYear() + 1);
  return d;
}

/**
 * The week the student is in: the last week whose syllabus date has passed. Without dates, the latest week that has notes, else week 1.
 */
export function currentWeek(weeks: WeekSummary[], now = new Date()): number {
  if (!weeks.length) return 1;
  const dated = weeks.map((w) => ({ week: w.week, at: w.date ? readSyllabusDate(w.date, now) : null })).filter((w): w is { week: number; at: Date } => !!w.at);
  if (dated.length) {
    const passed = dated.filter((w) => w.at.getTime() <= now.getTime());
    return passed.length ? passed[passed.length - 1].week : dated[0].week;
  }
  const written = weeks.filter((w) => w.hasNotes);
  return written.length ? written[written.length - 1].week : weeks[0].week;
}
