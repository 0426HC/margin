import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

/** The page is a list of blocks, so what is saved is structure and text, never markup. */
export const noteBlocksSchema = z
  .array(z.object({ type: z.enum(["heading", "paragraph", "bullet"]), text: z.string().max(20_000) }))
  .max(20_000);
export type NoteBlock = z.infer<typeof noteBlocksSchema>[number];

export interface Notepad {
  blocks: NoteBlock[];
  updatedAt: number | null;
}

export function getNotepad(db: Db, projectId: string): Notepad {
  const row = db.select().from(s.talkNotepad).where(eq(s.talkNotepad.projectId, projectId)).get();
  return row ? { blocks: row.blocks, updatedAt: row.updatedAt } : { blocks: [], updatedAt: null };
}

export function saveNotepad(db: Db, projectId: string, blocks: NoteBlock[]): Notepad {
  const updatedAt = Date.now();
  db.insert(s.talkNotepad).values({ projectId, blocks, updatedAt }).onConflictDoUpdate({ target: s.talkNotepad.projectId, set: { blocks, updatedAt } }).run();
  return { blocks, updatedAt };
}

/** Blocks that contain every word of the query (case-insensitive), by index, with a short line to show in the results. */
export function searchBlocks(blocks: NoteBlock[], query: string): { index: number; text: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return blocks.flatMap((b, index) => {
    const lower = b.text.toLowerCase();
    return words.every((w) => lower.includes(w)) ? [{ index, text: b.text.length > 120 ? `${b.text.slice(0, 120).trimEnd()}…` : b.text }] : [];
  });
}
