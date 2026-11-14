import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

// The demo course ships as one JSON file: the public-domain sample course already split into sections and layers,
// with every layer's Source and Explained written. It is built once by `npm run demo:build` and opens instantly, offline.
const rows = z.array(z.record(z.string(), z.unknown()));
export const demoSeedSchema = z.object({
  version: z.literal(1),
  project: z.object({ name: z.string(), courseCode: z.string().nullable() }),
  units: rows,
  files: rows,
  sections: rows,
  passages: rows,
  parts: rows,
  layers: rows,
  layerPassages: rows,
  layerContent: rows,
});
export type DemoSeed = z.infer<typeof demoSeedSchema>;

/** Everything about one project that the demo needs, as plain rows. */
export function exportDemoSeed(db: Db, projectId: string): DemoSeed {
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) throw new Error("No such project.");
  const parts = db.select().from(s.parts).where(eq(s.parts.projectId, projectId)).all();
  const layers = parts.length ? db.select().from(s.layers).where(inArray(s.layers.partId, parts.map((p) => p.id))).all() : [];
  const layerIds = layers.map((l) => l.id);
  // The file bodies stay out of the seed: the demo's text lives in its sections and passages.
  const files = db.select().from(s.files).where(eq(s.files.projectId, projectId)).all().map((f) => ({ ...f, parsed: null, storedPath: null }));
  return {
    version: 1,
    project: { name: project.name, courseCode: project.courseCode },
    units: db.select().from(s.units).where(eq(s.units.projectId, projectId)).all(),
    files,
    sections: db.select().from(s.sections).where(eq(s.sections.projectId, projectId)).all(),
    passages: db.select().from(s.passages).where(eq(s.passages.projectId, projectId)).all(),
    parts,
    layers,
    layerPassages: layerIds.length ? db.select().from(s.layerPassages).where(inArray(s.layerPassages.layerId, layerIds)).all() : [],
    layerContent: layerIds.length ? db.select().from(s.layerContent).where(inArray(s.layerContent.layerId, layerIds)).all() : [],
  };
}

/**
 * Create the demo project from a seed, with fresh ids so it never collides with anything. It is read-only, and every layer is
 * already written and its Parts approved. If a demo project exists, its id is returned instead of making a second.
 */
export function importDemoSeed(db: Db, seed: DemoSeed): string {
  const existing = db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.isDemo, true)).get();
  if (existing) return existing.id;
  const ids = new Map<string, string>();
  const m = (old: unknown) => {
    if (typeof old !== "string") return old as null;
    if (!ids.has(old)) ids.set(old, nanoid(10));
    return ids.get(old)!;
  };
  const projectId = nanoid(10);
  // Loosely typed on purpose: the seed was written from these same tables, and every row is checked as it goes in.
  type Row = Record<string, unknown>;
  const withIds = (list: Row[], map: (r: Row) => Row) => list.map(map);
  db.transaction((tx) => {
    tx.insert(s.projects).values({ id: projectId, name: seed.project.name, courseCode: seed.project.courseCode, isDemo: true, status: "ready" }).run();
    for (const r of withIds(seed.units, (r) => ({ ...r, id: m(r.id), projectId }))) tx.insert(s.units).values(r as typeof s.units.$inferInsert).run();
    for (const r of withIds(seed.files, (r) => ({ ...r, id: m(r.id), projectId, unitId: m(r.unitId) }))) tx.insert(s.files).values(r as typeof s.files.$inferInsert).run();
    for (const r of withIds(seed.sections, (r) => ({ ...r, id: m(r.id), projectId, unitId: m(r.unitId), fileId: m(r.fileId) }))) tx.insert(s.sections).values(r as typeof s.sections.$inferInsert).run();
    for (const r of withIds(seed.passages, (r) => ({ ...r, id: m(r.id), projectId, fileId: m(r.fileId), sectionId: m(r.sectionId) }))) tx.insert(s.passages).values(r as typeof s.passages.$inferInsert).run();
    for (const r of withIds(seed.parts, (r) => ({ ...r, id: m(r.id), projectId }))) tx.insert(s.parts).values(r as typeof s.parts.$inferInsert).run();
    for (const r of withIds(seed.layers, (r) => ({ ...r, id: m(r.id), partId: m(r.partId) }))) tx.insert(s.layers).values(r as typeof s.layers.$inferInsert).run();
    for (const r of withIds(seed.layerPassages, (r) => ({ ...r, layerId: m(r.layerId), passageId: m(r.passageId) }))) tx.insert(s.layerPassages).values(r as typeof s.layerPassages.$inferInsert).run();
    for (const r of withIds(seed.layerContent, (r) => {
      const source = (r.source as s.SourceQuote[]).map((q) => ({ ...q, passageId: m(q.passageId) as string }));
      return { ...r, id: m(r.id), layerId: m(r.layerId), source };
    })) tx.insert(s.layerContent).values(r as typeof s.layerContent.$inferInsert).run();
  });
  return projectId;
}
