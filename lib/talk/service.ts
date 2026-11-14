import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { stripInvalidCitations } from "@/lib/ai/citations";
import type { Engine, StreamChunk } from "@/lib/ai/engine";
import { talkToProfessor } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { StructureError } from "@/lib/layers/service";

/** The two conversations: Let's talk! and the Note to Self chat. Each has its own history; both search the whole course the same way. */
export type Channel = "talk" | "note";

export interface TalkMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "From Layer 3: The large republic" when the message was sent from inside a layer; null from the Let's talk! section. */
  context: string | null;
  /** The passage highlighted in Note to Self that the question is about; consecutive messages with the same topic are one thread. */
  topic: string | null;
  createdAt: number;
}

/** How many passages the professor reads per question, and how much of the conversation it sees. */
export const TALK_PASSAGES = 8;
const TALK_TURNS = 8;

/** Let's talk!'s saved history for one project, oldest first. */
export function getTalk(db: Db, projectId: string, channel: Channel = "talk"): TalkMessage[] {
  return db.select({ id: s.talkMessages.id, role: s.talkMessages.role, content: s.talkMessages.content, context: s.talkMessages.context, topic: s.talkMessages.topic, createdAt: s.talkMessages.createdAt }).from(s.talkMessages).where(and(eq(s.talkMessages.projectId, projectId), eq(s.talkMessages.channel, channel))).orderBy(asc(s.talkMessages.createdAt), sql`rowid`).all();
}

const save = (db: Db, projectId: string, channel: Channel, role: "user" | "assistant", content: string, context: string | null = null, topic: string | null = null) =>
  db.insert(s.talkMessages).values({ id: nanoid(10), projectId, channel, role, content, context, topic, createdAt: Date.now() }).run();

/** Where a question was asked from, for the small subtitle above it. A layer is numbered within its Part, as the layer list shows it. */
export function contextLabel(db: Db, projectId: string, from: { layerId?: string; partId?: string } | undefined): string | null {
  if (from?.layerId) {
    const layer = db.select().from(s.layers).where(eq(s.layers.id, from.layerId)).get();
    const part = layer && db.select().from(s.parts).where(eq(s.parts.id, layer.partId)).get();
    if (!layer || !part || part.projectId !== projectId) return null;
    const n = db.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.partId, part.id)).orderBy(asc(s.layers.position)).all().findIndex((l) => l.id === layer.id) + 1;
    return `From Layer ${n}: ${layer.title}`;
  }
  if (from?.partId) {
    const part = db.select().from(s.parts).where(eq(s.parts.id, from.partId)).get();
    return part && part.projectId === projectId ? `From ${part.title} synthesis` : null;
  }
  return null;
}

/**
 * Ask the professor, from the Let's talk! section or from inside a layer: it is one conversation per project, and a message sent from a
 * layer remembers which one (`from`). The app searches all of the project's files (BM25) and puts the best passages in the prompt; a short
 * follow-up is searched together with the question before it, so "and why?" still finds the right pages. The question is saved
 * first; the reply is saved when it ends, with any citation that wasn't in the passages sent stripped. If the reader presses
 * Stop, what had arrived is kept.
 */
export async function* talk(db: Db, engine: Engine, projectId: string, question: string, from?: { layerId?: string; partId?: string; topic?: string; channel?: Channel }, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  if (!db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get()) throw new StructureError("That project no longer exists. Go back to the home page.");
  const text = question.trim();
  const channel = from?.channel ?? "talk";
  const history = getTalk(db, projectId, channel).slice(-TALK_TURNS);
  const lastAsked = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const topic = from?.topic?.trim() || undefined;
  // a highlighted passage is what the question is about, so it is searched together with the question
  const hits = searchPassages(db, projectId, topic ? `${topic.slice(0, 600)} ${text}` : text.split(/\s+/).length < 6 ? `${lastAsked} ${text}` : text, TALK_PASSAGES);
  const passages = hits.map((h) => ({ file: h.file, page: h.page, text: h.text }));
  save(db, projectId, channel, "user", text, channel === "talk" ? contextLabel(db, projectId, from) : null, topic ?? null);
  let reply = "";
  try {
    for await (const chunk of talkToProfessor(engine, { passages, history: history.map(({ role, content }) => ({ role, content })), question: text, topic, notebook: channel === "note" ? notebookText(db, projectId) : undefined }, signal)) {
      if (chunk.type === "text") reply += chunk.delta;
      yield chunk;
    }
  } finally {
    // runs on a normal end, on Stop and on an error: whatever the professor had said is kept
    if (reply.trim()) save(db, projectId, channel, "assistant", stripInvalidCitations(reply, passages).text);
  }
}

const NOTEBOOK_CHARS = 6000;
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

/**
 * What the Note to Self chat knows beyond the course files: the student's saved write-up and quick notes for each layer, in course order
 * (so an edited write-up is what it sees). Empty slots are left out, and the whole thing is capped so the prompt stays small.
 */
export function notebookText(db: Db, projectId: string): string {
  const guide = getNoteGuide(db, projectId);
  if (!guide) return "";
  const blocks = guide.parts.flatMap((p) => [...p.layers, p.synthesis]).flatMap((slot) => {
    if (!slot.final && !slot.quick.trim()) return [];
    return [`### ${slot.title}\n${slot.final ? `Write-up: ${clip(slot.final.text, 1500)}\n` : ""}${slot.quick.trim() ? `Quick notes: ${clip(slot.quick.trim(), 800)}` : ""}`.trimEnd()];
  });
  return clip(blocks.join("\n\n"), NOTEBOOK_CHARS);
}
