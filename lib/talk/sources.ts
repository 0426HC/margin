import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { splitCitations } from "@/lib/ai/citations";
import type { Engine } from "@/lib/ai/engine";
import { pickTalkSources } from "@/lib/ai/tasks";
import { failTask, finishTask, startTask } from "@/lib/agents/tasks";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";
import { StructureError } from "@/lib/layers/service";

export interface TalkSource {
  id: string;
  passageId: string;
  topic: string;
  file: string;
  page: number;
  /** The passage, exactly as stored. Copied by code, never written by the AI. */
  text: string;
}
export interface SourceGroup {
  topic: string;
  sources: TalkSource[];
}

/** Candidates the Librarian may choose from, and how much of the conversation it reads. */
const CANDIDATES = 36;
const PER_MESSAGE = 5;
const CONVERSATION_CHARS = 7000;
const CURSOR = "talk-sources-through";

/** The collected sources, grouped by topic in the order each topic first appeared. */
export function getSources(db: Db, projectId: string): SourceGroup[] {
  const rows = db.select().from(s.talkSources).where(eq(s.talkSources.projectId, projectId)).orderBy(asc(s.talkSources.createdAt), sql`rowid`).all();
  const groups = new Map<string, SourceGroup>();
  for (const r of rows) {
    const g = groups.get(r.topic.toLowerCase()) ?? { topic: r.topic, sources: [] };
    g.sources.push({ id: r.id, passageId: r.passageId, topic: r.topic, file: r.file, page: r.page, text: r.text });
    groups.set(r.topic.toLowerCase(), g);
  }
  return [...groups.values()];
}

const cursorOf = (db: Db, projectId: string) => Number(db.select({ v: s.uiState.value }).from(s.uiState).where(and(eq(s.uiState.projectId, projectId), eq(s.uiState.key, CURSOR))).get()?.v ?? 0);
function setCursor(db: Db, projectId: string, rowid: number) {
  db.insert(s.uiState).values({ id: nanoid(10), projectId, key: CURSOR, value: rowid }).onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: rowid } }).run();
}

/** The conversation since the Librarian last read it (by message order). */
function unread(db: Db, projectId: string) {
  const after = cursorOf(db, projectId);
  return db
    .select({ rowid: sql<number>`rowid`, role: s.talkMessages.role, content: s.talkMessages.content })
    .from(s.talkMessages)
    .where(and(eq(s.talkMessages.projectId, projectId), eq(s.talkMessages.channel, "talk"), sql`rowid > ${after}`))
    .orderBy(sql`rowid`)
    .all();
}

/** Whether there is anything new to read: used to skip the work, and the agent's busy state, when the student only visited. */
export const hasUnread = (db: Db, projectId: string) => unread(db, projectId).length > 0;

/** Passages the conversation likely rests on: the pages the professor cited, then the best matches for each message. */
function candidatesFor(db: Db, projectId: string, messages: { role: string; content: string }[], collected: Set<string>) {
  const out = new Map<string, { passageId: string; file: string; page: number; text: string }>();
  const add = (p: { passageId: string; file: string; page: number; text: string }) => {
    if (!collected.has(p.passageId) && out.size < CANDIDATES) out.set(p.passageId, p);
  };
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const part of splitCitations(m.content)) {
      if (!("cite" in part)) continue;
      const rows = db.all<{ passageId: string; file: string; page: number; text: string }>(sql`
        select p.id as passageId, f.name as file, p.page as page, p.text as text from passages p join files f on f.id = p.file_id
        where p.project_id = ${projectId} and f.name = ${part.cite.file} and p.page = ${part.cite.page} order by p.ordinal limit 3`);
      rows.forEach(add);
    }
  }
  for (const m of messages) searchPassages(db, projectId, m.content.slice(0, 400), PER_MESSAGE).forEach((h) => add({ passageId: h.passageId, file: h.file, page: h.page, text: h.text }));
  return [...out.values()];
}

const inflight = new Set<string>();

export type CollectResult = { added: number; topics: string[]; skipped?: "nothing-new" | "already-running" };

/**
 * The Librarian reads what was discussed since it last looked and collects verbatim passages from the student's files, grouped by topic.
 * The AI only picks passage numbers; code copies the stored text. A passage already collected is never added again. While it works
 * the Librarian shows as busy, and when it finishes the result waits in "While you were away".
 */
export async function collectTalkSources(db: Db, engine: Engine, projectId: string, signal?: AbortSignal): Promise<CollectResult> {
  if (!db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId)).get()) throw new StructureError("That project no longer exists. Go back to the home page.");
  if (inflight.has(projectId)) return { added: 0, topics: [], skipped: "already-running" };
  const messages = unread(db, projectId);
  if (!messages.length) return { added: 0, topics: [], skipped: "nothing-new" };
  inflight.add(projectId);
  const task = startTask(db, projectId, "librarian", "find-sources", "Collecting sources from your conversation");
  try {
    const through = messages[messages.length - 1].rowid;
    const collected = new Set(db.select({ id: s.talkSources.passageId }).from(s.talkSources).where(eq(s.talkSources.projectId, projectId)).all().map((r) => r.id));
    const candidates = candidatesFor(db, projectId, messages, collected);
    const topics: string[] = [];
    let added = 0;
    if (candidates.length) {
      const conversation = messages.map((m) => `${m.role === "user" ? "Student" : "Professor"}: ${m.content}`).join("\n\n").slice(-CONVERSATION_CHARS);
      const existing = getSources(db, projectId).map((g) => g.topic);
      const picked = await pickTalkSources(engine, { conversation, passages: candidates.map((c, i) => ({ n: i + 1, file: c.file, page: c.page, text: c.text })), topics: existing }, signal);
      const known = new Map(existing.map((t) => [t.toLowerCase(), t]));
      for (const group of picked.topics) {
        const topic = known.get(group.topic.toLowerCase()) ?? group.topic;
        for (const n of group.passages) {
          const c = candidates[n - 1]; // a number that was not sent is dropped
          if (!c || collected.has(c.passageId)) continue;
          // the text comes from storage, never from the model
          const text = db.select({ text: s.passages.text }).from(s.passages).where(eq(s.passages.id, c.passageId)).get()?.text;
          if (!text) continue;
          db.insert(s.talkSources).values({ id: nanoid(10), projectId, passageId: c.passageId, topic, file: c.file, page: c.page, text }).onConflictDoNothing().run();
          collected.add(c.passageId);
          known.set(topic.toLowerCase(), topic);
          if (!topics.includes(topic)) topics.push(topic);
          added++;
        }
      }
    }
    setCursor(db, projectId, through);
    finishTask(db, task, added ? `Collected ${added} ${added === 1 ? "source" : "sources"} on ${topics.slice(0, 3).join(", ")}${topics.length > 3 ? " and more" : ""}` : "Found nothing new to collect from this conversation");
    return { added, topics };
  } catch (e) {
    failTask(db, task, "The Librarian couldn't finish. Try “Find sources now” again.");
    throw e;
  } finally {
    inflight.delete(projectId);
  }
}
