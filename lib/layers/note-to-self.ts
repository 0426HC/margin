import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SavedVersion } from "./loop";
import { countStates, type LayerState, type ProgressCounts } from "./progress";
import { getCondensed } from "@/lib/talk/condensed";
import { getQuickNotes, quickNoteKey } from "@/lib/talk/quicknotes";
import { getStructure, rowLabel } from "./service";
import { migratePartsToWeeks } from "./migrate-weeks";

export interface NoteEntry {
  kind: "layer" | "part";
  id: string;
  title: string;
  /** What the student chose to send: their own writing exactly as submitted, or the refined version. */
  text: string;
  /** Which of the two it is, so it is always labelled. */
  version: SavedVersion;
}
export interface NoteWeek {
  key: string;
  week: number;
  title: string;
  synthesis: NoteEntry | null;
  layers: NoteEntry[];
}

/**
 * Note to Self: only what the student sent with "Send to Note to Self?", one version per layer or week synthesis, in course order.
 * Drafts and chat are never read here; the refined version appears only when the student chose it, and is labelled.
 */
export function getNoteToSelf(db: Db, projectId: string): NoteWeek[] {
  migratePartsToWeeks(db, projectId);
  const parts = db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).orderBy(asc(s.parts.position), asc(s.parts.key)).all();
  return parts.map((part) => {
    const layers = db.select().from(s.layers).where(eq(s.layers.partId, part.id)).orderBy(asc(s.layers.position)).all();
    const savedFor = (type: "layer" | "part", ids: string[]) =>
      ids.length
        ? db
            .select({ targetId: s.noteSaves.targetId, version: s.noteSaves.version, text: s.noteSaves.text })
            .from(s.noteSaves)
            .where(and(eq(s.noteSaves.targetType, type), inArray(s.noteSaves.targetId, ids)))
            .all()
        : [];
    const byLayer = new Map(savedFor("layer", layers.map((l) => l.id)).map((f) => [f.targetId, f]));
    const synthesis = savedFor("part", [part.id])[0];
    return {
      key: part.key,
      week: part.week ?? 0,
      title: rowLabel(part),
      synthesis: synthesis ? { kind: "part" as const, id: part.id, title: `${rowLabel(part)} synthesis`, text: synthesis.text, version: synthesis.version } : null,
      layers: layers.flatMap((l) => {
        const f = byLayer.get(l.id);
        return f ? [{ kind: "layer" as const, id: l.id, title: l.title, text: f.text, version: f.version }] : [];
      }),
    };
  });
}

/** One place in the study guide: a layer or a week synthesis, finished or still waiting. */
export interface GuideSlot {
  kind: "layer" | "part";
  id: string;
  title: string;
  /** The question the layer answers. Null for a synthesis. */
  bigQuestion: string | null;
  state: LayerState;
  /** What the student sent to Note to Self, only when there is something. Drafts never appear here. */
  final: { text: string; version: SavedVersion } | null;
  /** The student's quick notes for this layer or synthesis, beside the write-up. Empty when there are none. */
  quick: string;
}
export interface GuideWeek {
  key: string;
  week: number;
  title: string;
  progress: ProgressCounts;
  layers: GuideSlot[];
  synthesis: GuideSlot;
}
export interface NoteGuide {
  project: { id: string; name: string };
  weeks: GuideWeek[];
  resume: { layerId: string; title: string } | null;
  /** Layers and syntheses saved to Note to Self, for "nothing yet" checks. */
  finished: number;
  /** The project's condensed notes: one page, not tied to any layer. */
  condensed: string;
}

/**
 * The whole study guide, empty or not: every week that has layers, its layers in idea order and then its synthesis.
 * Saved slots carry what the student sent (from getNoteToSelf, so nothing else can leak in); the rest are placeholders.
 */
export function getNoteGuide(db: Db, projectId: string): NoteGuide | null {
  const model = getStructure(db, projectId);
  if (!model) return null;
  const finals = new Map(getNoteToSelf(db, projectId).flatMap((p) => [...p.layers, ...(p.synthesis ? [p.synthesis] : [])]).map((e) => [`${e.kind}:${e.id}`, e]));
  const quick = getQuickNotes(db, projectId);
  const slot = (kind: "layer" | "part", id: string, title: string, bigQuestion: string | null, fallback: LayerState): GuideSlot => {
    const f = finals.get(`${kind}:${id}`);
    return { kind, id, title, bigQuestion, state: f ? "saved" : fallback, final: f ? { text: f.text, version: f.version } : null, quick: quick[quickNoteKey(kind, id)] ?? "" };
  };
  const weeks = model.weeks.filter((w) => w.id !== null).map((p) => ({
    key: p.key,
    week: p.week,
    title: p.label,
    progress: countStates(p.layers.map((l) => finals.get(`layer:${l.id}`) ? "saved" : l.state)),
    layers: p.layers.map((l) => slot("layer", l.id, l.title, l.bigQuestion, l.state)),
    synthesis: slot("part", p.id!, `${p.label} synthesis`, null, p.synthesis),
  }));
  return {
    project: { id: projectId, name: model.project.name },
    weeks,
    resume: model.resume,
    finished: weeks.reduce((n, p) => n + p.layers.filter((l) => l.final).length + (p.synthesis.final ? 1 : 0), 0),
    condensed: getCondensed(db, projectId),
  };
}
