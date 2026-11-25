import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { arrowed } from "./quicknotes";

/**
 * Condensed notes: one empty page per project where the student reads the Note to Self write-ups and writes a shorter version. Not tied
 * to any layer, so it can be written with nothing saved yet. Kept in the project's ui_state, so deleting the project deletes it too.
 */
const KEY = "condensed-notes";
export const condensedSchema = z.object({ text: z.string().max(200_000) });

export function getCondensed(db: Db, projectId: string): string {
  const row = db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, KEY))).get();
  return typeof row?.v === "string" ? row.v : "";
}

/** Autosave. "->" becomes an arrow, as everywhere in the notebook; an emptied page leaves nothing behind. */
export function saveCondensed(db: Db, projectId: string, text: string): string {
  const clean = arrowed(text);
  const where = and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, KEY));
  if (!clean.trim()) db.delete(s.uiState).where(where).run();
  else db.insert(s.uiState).values({ id: `${projectId}:${KEY}`, projectId, key: KEY, value: clean }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: clean } }).run();
  return clean;
}
