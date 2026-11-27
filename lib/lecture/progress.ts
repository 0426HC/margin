/**
 * Where the writing of a week's Lecture tab is, so the page can show each section as Claude writes it: the text so far of every section
 * being written. One record per week being written, on globalThis (the background worker and the routes load separate copies of this
 * module); a page that opens the tab while it is being written picks it up, text and all.
 */

export type LecturePart = "notes" | "material";

export interface LectureProgress {
  /** The sections being written, with their text so far ("" until the first words arrive). */
  writing: Partial<Record<LecturePart, string>>;
}

type Entry = { progress: LectureProgress; listeners: Set<(p: LectureProgress) => void>; timer: ReturnType<typeof setTimeout> | null };
const KEY = "__margin_lecture_progress__";
const registry = (): Map<string, Entry> => ((globalThis as unknown as Record<string, Map<string, Entry>>)[KEY] ??= new Map());

/** New text is passed on at most this often, so a fast stream doesn't flood the page. */
const TEXT_EVERY_MS = 200;

export const weekKey = (projectId: string, week: number) => `${projectId}:${week}`;
const tell = (e: Entry) => e.listeners.forEach((l) => l(e.progress));

export function startLecture(key: string, parts: LecturePart[]) {
  const progress: LectureProgress = { writing: Object.fromEntries(parts.map((p) => [p, ""])) };
  const entry = registry().get(key);
  if (entry) {
    entry.progress = progress;
    tell(entry);
  } else registry().set(key, { progress, listeners: new Set(), timer: null });
}

export function setLectureText(key: string, part: LecturePart, text: string) {
  const entry = registry().get(key);
  if (!entry) return;
  entry.progress = { writing: { ...entry.progress.writing, [part]: text } };
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    tell(entry);
  }, TEXT_EVERY_MS);
}

/** One section is finished (saved or failed): it is no longer shown as being written. */
export function endLecturePart(key: string, part: LecturePart) {
  const entry = registry().get(key);
  if (!entry) return;
  const writing = { ...entry.progress.writing };
  delete writing[part];
  entry.progress = { writing };
  tell(entry);
}

export function finishLecture(key: string) {
  const entry = registry().get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.listeners.clear();
  registry().delete(key);
}

/** Follow a week's writing: called at once with where it is now, then on every change, until it ends. Returns the unsubscribe. */
export function watchLecture(key: string, fn: (p: LectureProgress) => void): () => void {
  const entry = registry().get(key);
  if (!entry) return () => {};
  entry.listeners.add(fn);
  fn(entry.progress);
  return () => entry.listeners.delete(fn);
}
