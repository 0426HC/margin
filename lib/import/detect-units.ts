/** Groups files into units from folder and file names. Pure: names in, units out. */

export interface DetectedUnit {
  key: string;
  title: string;
  isOverview: boolean;
  fileIds: string[];
}

const KEYWORDS: Record<string, string> = {
  week: "Week", wk: "Week", module: "Module", mod: "Module", unit: "Unit",
  lecture: "Lecture", lec: "Lecture", chapter: "Chapter", ch: "Chapter", topic: "Topic", session: "Session",
};
const UNIT_RE = /(?<![a-z])(week|wk|module|mod|unit|lecture|lec|chapter|ch|topic|session)(?![a-z])[\s._-]*0*(\d+)/i;
const SYLLABUS_RE = /syllab|course outline|course overview/i;

const stripExt = (s: string) => s.replace(/\.[a-z0-9]{1,5}$/i, "");
const tidy = (s: string) => s.replace(/^[\s:–—._-]+|[\s:–—._-]+$/g, "");

interface Hit { key: string; kind: string; n: number; rest: string }

function match(segment: string, isFolder: boolean): Hit | null {
  const m = UNIT_RE.exec(segment);
  if (!m) return null;
  const kind = KEYWORDS[m[1].toLowerCase()];
  const n = Number(m[2]);
  const rest = isFolder ? tidy(segment.slice(m.index + m[0].length)) : "";
  return { key: `${kind.toLowerCase()}-${n}`, kind, n, rest };
}

export function detectUnits(files: { id: string; relPath: string }[]): DetectedUnit[] {
  const units = new Map<string, DetectedUnit & { n: number; order: number }>();
  const add = (key: string, title: string, isOverview: boolean, n: number, id: string) => {
    const u = units.get(key) ?? { key, title, isOverview, fileIds: [], n, order: units.size };
    u.fileIds.push(id);
    units.set(key, u);
    return u;
  };

  for (const f of files) {
    const segs = f.relPath.split("/").filter(Boolean);
    const name = stripExt(segs[segs.length - 1] ?? "");
    const folders = segs.slice(0, -1);
    if ([...folders, name].some((s) => SYLLABUS_RE.test(s))) {
      add("overview", "Course overview", true, -1, f.id);
      continue;
    }
    // folders first, outermost to innermost; the file name only if no folder says anything
    const hit =
      folders.map((s) => match(s, true)).find(Boolean) ?? match(name, false);
    if (!hit) {
      add("misc", "Misc", false, Infinity, f.id);
      continue;
    }
    const u = add(hit.key, `${hit.kind} ${hit.n}`, false, hit.n, f.id);
    if (hit.rest && u.title === `${hit.kind} ${hit.n}`) u.title = `${hit.kind} ${hit.n}: ${hit.rest}`;
  }

  return [...units.values()]
    .sort((a, b) => (a.isOverview ? -1 : b.isOverview ? 1 : a.n - b.n || a.order - b.order))
    .map(({ key, title, isOverview, fileIds }) => ({ key, title, isOverview, fileIds }));
}

/** A course code such as POL101, taken from the file names. */
export function detectCourseCode(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of paths) {
    for (const m of p.matchAll(/(?<![A-Za-z])([A-Z]{2,4})[\s-]?(\d{3,4})(?!\d)/g)) {
      const code = `${m[1]}${m[2]}`;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
