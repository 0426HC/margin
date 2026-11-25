import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { stripInvalidCitations } from "@/lib/ai/citations";
import type { Engine, StreamChunk } from "@/lib/ai/engine";
import { talkToProfessor } from "@/lib/ai/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { gatherCourse } from "@/lib/brain/ask";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { rowLabel, StructureError } from "@/lib/layers/service";
import { clampCursor } from "./sources";

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

/** How much of the conversation the professor sees. */
const TALK_TURNS = 8;

/** Let's talk!'s saved history for one project, oldest first. */
export function getTalk(db: Db, projectId: string, channel: Channel = "talk"): TalkMessage[] {
  return db.select({ id: s.talkMessages.id, role: s.talkMessages.role, content: s.talkMessages.content, context: s.talkMessages.context, topic: s.talkMessages.topic, createdAt: s.talkMessages.createdAt }).from(s.talkMessages).where(and(eq(s.talkMessages.projectId, projectId), eq(s.talkMessages.channel, channel))).orderBy(asc(s.talkMessages.createdAt), sql`rowid`).all();
}

/**
 * The student deletes one message for good. A question goes together with the reply to it (the message right after it, if that is an
 * answer); an answer goes alone. Returns how many messages were deleted, 0 when it is not in this project.
 */
export function deleteTalkMessage(db: Db, projectId: string, messageId: string): number {
  const m = db.select({ id: s.talkMessages.id, role: s.talkMessages.role, channel: s.talkMessages.channel }).from(s.talkMessages).where(and(eq(s.talkMessages.id, messageId), eq(s.talkMessages.projectId, projectId))).get();
  if (!m) return 0;
  const ids = [m.id];
  if (m.role === "user") {
    const thread = getTalk(db, projectId, m.channel);
    const next = thread[thread.findIndex((x) => x.id === m.id) + 1];
    if (next?.role === "assistant") ids.push(next.id);
  }
  db.delete(s.talkMessages).where(inArray(s.talkMessages.id, ids)).run();
  clampCursor(db, projectId);
  return ids.length;
}

/** The student clears one whole conversation (Let's talk! or the Note to Self chat) for good. Returns how many messages were deleted. */
export function clearTalk(db: Db, projectId: string, channel: Channel): number {
  const n = db.delete(s.talkMessages).where(and(eq(s.talkMessages.projectId, projectId), eq(s.talkMessages.channel, channel))).run().changes;
  clampCursor(db, projectId);
  return n;
}

const save = (db: Db, projectId: string, channel: Channel, role: "user" | "assistant", content: string, context: string | null = null, topic: string | null = null) =>
  db.insert(s.talkMessages).values({ id: nanoid(10), projectId, channel, role, content, context, topic, createdAt: Date.now() }).run();

/** Where a question was asked from, for the small subtitle above it: "From Week 3, layer 2: …", numbered within its week as the layer list shows it. */
export function contextLabel(db: Db, projectId: string, from: { layerId?: string; partId?: string } | undefined): string | null {
  if (from?.layerId) {
    const layer = db.select().from(s.layers).where(eq(s.layers.id, from.layerId)).get();
    const part = layer && db.select().from(s.parts).where(eq(s.parts.id, layer.partId)).get();
    if (!layer || !part || part.projectId !== projectId) return null;
    const n = db.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.partId, part.id)).orderBy(asc(s.layers.position)).all().findIndex((l) => l.id === layer.id) + 1;
    return part.week !== null ? `From Week ${part.week}, layer ${n}: ${layer.title}` : `From Layer ${n}: ${layer.title}`;
  }
  if (from?.partId) {
    const part = db.select().from(s.parts).where(eq(s.parts.id, from.partId)).get();
    return part && part.projectId === projectId ? `From ${rowLabel(part)} synthesis` : null;
  }
  return null;
}

/**
 * Ask the professor, from the Let's talk! section or from inside a layer: it is one conversation per project, and a message sent from a
 * layer remembers which one (`from`). The course brain finds what the question needs (`lib/brain/ask.ts`): the notes it is about, the notes
 * linked to them, and the real passages they point at, with the reading notes for context; weeks the brain hasn't read yet are searched by
 * word, and the answer starts with one line saying so. A short follow-up is read together with the question before it, so "and why?" still
 * finds the right pages. The question is saved first; the reply is saved when it ends, with any citation that wasn't in the passages sent
 * stripped. If the reader presses Stop, what had arrived is kept.
 */
export async function* talk(db: Db, engine: Engine, projectId: string, question: string, from?: { layerId?: string; partId?: string; topic?: string; channel?: Channel }, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  if (!db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get()) throw new StructureError("That project no longer exists. Go back to the home page.");
  const text = question.trim();
  const channel = from?.channel ?? "talk";
  const history = getTalk(db, projectId, channel).slice(-TALK_TURNS);
  const lastAsked = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const topic = from?.topic?.trim() || undefined;
  let sent: { file: string; page: number }[] = [];
  save(db, projectId, channel, "user", text, channel === "talk" ? contextLabel(db, projectId, from) : null, topic ?? null);
  let reply = "";
  try {
    // a highlighted passage is what the question is about, so it is read together with the question
    const found = await gatherCourse(db, engine, projectId, { question: text, context: lastAsked || undefined, topic }, { signal });
    const passages = found.passages;
    if (found.line) {
      reply = `${found.line}\n\n`;
      yield { type: "text", delta: reply };
    }
    sent = passages;
    for await (const chunk of talkToProfessor(engine, { passages, readings: found.readings, history: history.map(({ role, content }) => ({ role, content: withoutSearchLine(content) })), question: text, topic, notebook: channel === "note" ? notebookText(db, projectId) : undefined }, signal)) {
      if (chunk.type === "text") reply += chunk.delta;
      yield chunk;
    }
  } finally {
    // runs on a normal end, on Stop and on an error: whatever the professor had said is kept
    if (reply.trim()) save(db, projectId, channel, "assistant", stripInvalidCitations(reply, sent).text);
  }
}

/** An earlier answer without its "I haven't finished reading…" line: the professor doesn't need to hear it again. */
const withoutSearchLine = (t: string) => t.replace(/^I haven't finished reading [^\n]*? quick search\.\n\n/, "");

const NOTEBOOK_CHARS = 6000;
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

/**
 * What the Note to Self chat knows beyond the course files: the student's saved write-up and quick notes for each layer, in course order
 * (so an edited write-up is what it sees). Empty slots are left out, and the whole thing is capped so the prompt stays small.
 */
export function notebookText(db: Db, projectId: string): string {
  const guide = getNoteGuide(db, projectId);
  if (!guide) return "";
  const blocks = guide.weeks.flatMap((w) => [...w.layers, w.synthesis]).flatMap((slot) => {
    if (!slot.final && !slot.quick.trim()) return [];
    return [`### ${slot.title}\n${slot.final ? `Write-up: ${clip(slot.final.text, 1500)}\n` : ""}${slot.quick.trim() ? `Quick notes: ${clip(slot.quick.trim(), 800)}` : ""}`.trimEnd()];
  });
  return clip(blocks.join("\n\n"), NOTEBOOK_CHARS);
}
