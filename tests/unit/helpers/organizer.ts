import type { AiRequest } from "@/lib/ai/engine";
import { cannedJson } from "@/lib/ai/canned";
import type { CourseCheckIn, CourseMapAnswer, CourseMapAnswerIn } from "@/lib/ai/schemas";
import type { FileType } from "@/lib/projects/file-kinds";

export interface ScriptedLabel {
  week: number | null;
  type: FileType;
  confidence?: "sure" | "check";
  reason?: string;
}

/**
 * Plays Claude reading one made-up course: the answer a careful reader would give for that course, written by hand in the test. Files
 * are found in the prompt by their path, so the test speaks in paths and the helper turns them into the ids Claude must answer with.
 * Every other AI call (the layer plan, Explained…) goes to the offline stand-in.
 */
export function scriptedOrganizer(script: {
  isSyllabus: (path: string) => boolean;
  weeks: CourseMapAnswer["weeks"];
  breaks?: CourseMapAnswer["breaks"];
  label: (path: string) => ScriptedLabel;
  courseCode?: string | null;
  missingReadings?: CourseMapAnswer["missingReadings"];
  notInSyllabus?: (path: string) => boolean;
  /** The final check's answer, by file path (default: nothing to change). `ids` turns a path into the id Claude was given. */
  check?: (ids: (path: string) => string, req: AiRequest) => CourseCheckIn;
}) {
  return (req: AiRequest): unknown => {
    if (req.system.includes("find the SYLLABUS")) return { syllabus: [...req.prompt.matchAll(/^(F\d+) \| ([^|]+?) \|/gm)].filter((m) => script.isSyllabus(m[2])).map((m) => m[1]) };
    if (req.system.includes("You are a sharp teaching assistant")) {
      const ids = new Map([...req.prompt.matchAll(/^(F\d+) \| ([^|]+?) \|/gm)].map((m) => [m[2], m[1]]));
      const idOf = (end: string) => [...ids].find(([p]) => p.endsWith(end))?.[1] ?? `missing:${end}`;
      return script.check?.(idOf, req) ?? NO_CHANGES;
    }
    if (!req.system.includes("You organise a university student's course folder")) return cannedJson(req);
    const files = [...req.prompt.matchAll(/^### (F\d+) \| (.+)$/gm)].map((m) => ({ id: m[1], path: m[2] }));
    return {
      courseCode: script.courseCode ?? null,
      weeks: script.weeks,
      breaks: script.breaks ?? [],
      files: files.map((f) => {
        const l = script.label(f.path);
        return { file: f.id, week: l.week, type: l.type, confidence: l.confidence ?? "sure", reason: l.reason ?? `Read as ${l.type}${l.week ? ` for week ${l.week}` : ""}.` };
      }),
      missingReadings: script.missingReadings ?? [],
      notInSyllabus: files.filter((f) => script.notInSyllabus?.(f.path)).map((f) => f.id),
    } satisfies CourseMapAnswerIn;
  };
}

/** The final check finding nothing to change. */
export const NO_CHANGES: CourseCheckIn = { weeks: null, breaks: null, missingReadings: null, files: [], notes: [] };

/** The file paths Margin sent in the last course-map call (so tests can check what Claude was given). */
export const sentPaths = (req: AiRequest) => [...req.prompt.matchAll(/^### F\d+ \| (.+)$/gm)].map((m) => m[1]);

/** Weeks as a syllabus lists them: [title, date?, kind?] for weeks 1, 2, 3… */
export const weeksOf = (list: [string, string?, ("class" | "no-class" | "exam")?][]): CourseMapAnswer["weeks"] =>
  list.map(([title, date, kind], i) => ({ week: i + 1, date: date ?? null, title, kind: kind ?? "class", syllabus: title }));
