import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export type AgentTaskRow = typeof s.agentTasks.$inferSelect;
export type AgentId = AgentTaskRow["agent"];

/** A task that has been "running" this long is from a server that stopped; it is shown as failed, not busy forever. */
const STALE_MS = 15 * 60_000;

export function startTask(db: Db, projectId: string, agent: AgentId, kind: AgentTaskRow["kind"], summary: string): string {
  const id = nanoid(10);
  db.insert(s.agentTasks).values({ id, projectId, agent, kind, summary }).run();
  return id;
}

export function finishTask(db: Db, id: string, result: string) {
  db.update(s.agentTasks).set({ status: "done", result, finishedAt: Date.now() }).where(eq(s.agentTasks.id, id)).run();
}

export function failTask(db: Db, id: string, result: string) {
  // A failure is not "work finished while you were away": it is marked seen so only a real result reaches the card.
  db.update(s.agentTasks).set({ status: "failed", result, seen: true, finishedAt: Date.now() }).where(eq(s.agentTasks.id, id)).run();
}

/** What the dining hall needs: who is busy now, and what finished that the student hasn't dismissed. */
export function listTasks(db: Db, projectId: string, now = Date.now()) {
  const rows = db.select().from(s.agentTasks).where(eq(s.agentTasks.projectId, projectId)).orderBy(asc(s.agentTasks.createdAt)).all();
  for (const r of rows) {
    if (r.status === "running" && now - r.createdAt > STALE_MS) {
      failTask(db, r.id, "The task stopped before it finished.");
      r.status = "failed";
      r.seen = true;
    }
  }
  return {
    running: rows.filter((r) => r.status === "running"),
    unseen: rows.filter((r) => r.status === "done" && !r.seen),
  };
}

export function markSeen(db: Db, projectId: string, ids?: string[]) {
  const rows = db.select({ id: s.agentTasks.id }).from(s.agentTasks).where(and(eq(s.agentTasks.projectId, projectId), eq(s.agentTasks.status, "done"), eq(s.agentTasks.seen, false))).all();
  for (const r of rows) if (!ids || ids.includes(r.id)) db.update(s.agentTasks).set({ seen: true }).where(eq(s.agentTasks.id, r.id)).run();
}
