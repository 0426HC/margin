import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Engine } from "@/lib/ai/engine";
import { draftQuickNotes } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { StructureError } from "@/lib/layers/service";

export const quickNoteKey = (type: "layer" | "part", id: string) => `${type}:${id}`;
export const quickNoteSchema = z.object({ targetType: z.enum(["layer", "part"]), targetId: z.string().min(1), text: z.string().max(50_000) });

/** Typing "->" gives an arrow. Done as the student types, and again on save so a pasted "->" is turned too. */
export const arrowed = (text: string) => text.replaceAll("->", "→");

/** Every quick note of the project, by `layer:<id>` or `part:<id>`. */
export function getQuickNotes(db: Db, projectId: string): Record<string, string> {
  return Object.fromEntries(db.select().from(s.quickNotes).where(eq(s.quickNotes.projectId, projectId)).all().map((r) => [quickNoteKey(r.targetType, r.targetId), r.text]));
}

/** Whether the layer or Part belongs to the project, so one project can never write into another's notebook. */
export function belongsToProject(db: Db, projectId: string, type: "layer" | "part", id: string): boolean {
  if (type === "part") return db.select().from(s.parts).where(and(eq(s.parts.id, id), eq(s.parts.projectId, projectId))).get() !== undefined;
  const layer = db.select().from(s.layers).where(eq(s.layers.id, id)).get();
  return !!layer && db.select().from(s.parts).where(and(eq(s.parts.id, layer.partId), eq(s.parts.projectId, projectId))).get() !== undefined;
}

/** Autosave one layer's quick notes. An emptied note is deleted, so a blank page leaves nothing behind. */
export function saveQuickNote(db: Db, projectId: string, type: "layer" | "part", id: string, text: string): string {
  if (!belongsToProject(db, projectId, type, id)) throw new StructureError("That layer is no longer part of this project. Reload the page.");
  const clean = arrowed(text);
  const where = and(eq(s.quickNotes.projectId, projectId), eq(s.quickNotes.targetType, type), eq(s.quickNotes.targetId, id));
  if (!clean.trim()) db.delete(s.quickNotes).where(where).run();
  else db.insert(s.quickNotes).values({ projectId, targetType: type, targetId: id, text: clean, updatedAt: Date.now() }).onConflictDoUpdate({ target: [s.quickNotes.projectId, s.quickNotes.targetType, s.quickNotes.targetId], set: { text: clean, updatedAt: Date.now() } }).run();
  return clean;
}

/** Short arrow-style notes drafted from the saved write-up of that layer. Nothing is saved: the student edits them first. */
export async function draftFromWriteup(db: Db, engine: Engine, projectId: string, type: "layer" | "part", id: string, signal?: AbortSignal): Promise<string> {
  if (!belongsToProject(db, projectId, type, id)) throw new StructureError("That layer is no longer part of this project. Reload the page.");
  const saved = db.select().from(s.noteSaves).where(and(eq(s.noteSaves.targetType, type), eq(s.noteSaves.targetId, id))).get();
  if (!saved) throw new StructureError("Send this layer's write-up to Note to Self first, then I can draft notes from it.");
  const title = type === "layer" ? (db.select().from(s.layers).where(eq(s.layers.id, id)).get()?.title ?? "") : (db.select().from(s.parts).where(eq(s.parts.id, id)).get()?.title ?? "");
  const out = await draftQuickNotes(engine, { title, writeup: saved.text }, signal);
  return arrowed(out.trim());
}
