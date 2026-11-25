import { eq, inArray, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db/client";
import { filesDir } from "@/lib/db/paths";
import * as s from "@/lib/db/schema";

/**
 * Permanently delete a project and everything that belongs to it: its files on disk, and every row in every table (units, sections,
 * passages and their full-text entries, weeks, layers, write-ups, the layer chats, Note to Self, quick notes, Let's talk! messages,
 * Sources, the notepad, agent tasks, saved interface state).
 *
 * Most of it goes with the project through cascading foreign keys. Write-backs and layer chats are different: they point at a layer or a
 * week by id, with no link to the project, so they are deleted here first, by the ids of this project's layers and weeks. Nothing is
 * left behind: the full-text index is compacted and the database file is checkpointed, and deleted text is zeroed (`secure_delete`).
 * Returns false when there is no such project.
 */
export function deleteProject(db: Db, projectId: string): boolean {
  if (!/^[\w-]+$/.test(projectId)) return false;
  const project = db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get();
  if (!project) return false;

  const storedPaths = db.select({ p: s.files.storedPath }).from(s.files).where(eq(s.files.projectId, projectId)).all().flatMap((r) => (r.p ? [r.p] : []));

  db.transaction((tx) => {
    const partIds = tx.select({ id: s.parts.id }).from(s.parts).where(eq(s.parts.projectId, projectId)).all().map((r) => r.id);
    const layerIds = partIds.length ? tx.select({ id: s.layers.id }).from(s.layers).where(inArray(s.layers.partId, partIds)).all().map((r) => r.id) : [];
    const targets = [...partIds, ...layerIds];
    if (targets.length) {
      tx.delete(s.layerMessages).where(inArray(s.layerMessages.targetId, targets)).run();
      tx.delete(s.writebacks).where(inArray(s.writebacks.targetId, targets)).run(); // Note to Self saves go with their write-backs
      tx.delete(s.noteSaves).where(inArray(s.noteSaves.targetId, targets)).run();
    }
    tx.delete(s.projects).where(eq(s.projects.id, projectId)).run(); // everything else cascades
  });

  // the stored files: the project's own folder, and any stored path that somehow lies elsewhere
  const root = path.resolve(filesDir());
  const own = path.resolve(root, projectId);
  if (own.startsWith(root + path.sep)) fs.rmSync(own, { recursive: true, force: true });
  for (const p of storedPaths) fs.rmSync(p, { force: true });

  // compact the search index and flush the write-ahead log, so the deleted text is not kept in either
  db.run(sql`insert into passages_fts(passages_fts) values('optimize')`);
  db.all(sql`pragma wal_checkpoint(TRUNCATE)`);
  return true;
}
