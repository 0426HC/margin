/**
 * Moving a course from Parts to weeks, once. Before the weeks round a course was split into Parts (A, B…), each with its layers and a Part
 * synthesis. Now each row of the `parts` table is one week. This moves every layer, in its old order, into the week its passages come
 * from, and each Part synthesis (its write-ups, chat, Note to Self entry and quick notes) into the last week of that Part. Nothing the
 * student wrote is changed or lost; only where it hangs.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { passageWeeks } from "./passage-weeks";
import { courseWeekTitles, weekKey } from "./week-names";

/** The week a layer belongs to: the week most of its passages come from (the earlier one on a tie), or null when none has a week. */
export function mainWeek(weeks: number[]): number | null {
  if (!weeks.length) return null;
  const counts = new Map<number, number>();
  for (const w of weeks) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Whether this course still has Parts from before the weeks round. */
export function needsWeeks(db: Db, projectId: string): boolean {
  return !!db.select({ id: s.parts.id }).from(s.parts).where(and(eq(s.parts.projectId, projectId), isNull(s.parts.week))).get();
}

/** Move one course from Parts to weeks. Safe to call any time: a course already in weeks is left as it is. Returns whether it moved. */
export function migratePartsToWeeks(db: Db, projectId: string): boolean {
  if (!needsWeeks(db, projectId)) return false;
  db.transaction((tx) => {
    const old = tx.select().from(s.parts).where(and(eq(s.parts.projectId, projectId), isNull(s.parts.week))).orderBy(asc(s.parts.position), asc(s.parts.key)).all();
    const existing = tx.select().from(s.parts).where(eq(s.parts.projectId, projectId)).all().filter((p) => p.week !== null);
    const weekOf = passageWeeks(tx, projectId);
    // a course with no weeks anywhere: one week per unit, in unit order
    const unitRank = new Map(
      tx.select({ id: s.units.id }).from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.isOverview, false))).orderBy(asc(s.units.position)).all().map((u, i) => [u.id, i + 1]),
    );
    const anyWeek = weekOf.size > 0;

    // every layer, in the old course order, with the week it belongs to
    const layers = old.flatMap((part) =>
      tx.select().from(s.layers).where(eq(s.layers.partId, part.id)).orderBy(asc(s.layers.proposed), asc(s.layers.position)).all().map((l) => ({ l, part })),
    );
    const placed = layers.map(({ l, part }) => {
      const ps = tx.select({ id: s.passages.id, unitId: s.sections.unitId }).from(s.layerPassages).innerJoin(s.passages, eq(s.passages.id, s.layerPassages.passageId)).innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId)).where(eq(s.layerPassages.layerId, l.id)).all();
      const week = anyWeek ? mainWeek(ps.map((p) => weekOf.get(p.id)).filter((w): w is number => w !== undefined)) : mainWeek(ps.map((p) => unitRank.get(p.unitId)).filter((w): w is number => w !== undefined));
      return { l, part, week };
    });
    // a layer with no week takes the week of the layer before it (or after it, at the very start); a course with nothing at all is week 1
    for (let i = 0; i < placed.length; i++) if (placed[i].week === null) placed[i].week = placed.slice(0, i).reverse().find((x) => x.week !== null)?.week ?? null;
    for (let i = placed.length - 1; i >= 0; i--) if (placed[i].week === null) placed[i].week = placed.slice(i + 1).find((x) => x.week !== null)?.week ?? 1;

    const titles = courseWeekTitles(tx, projectId);
    const approved = old.every((p) => p.breakdownStatus === "approved");
    const rows = new Map(existing.map((p) => [p.week!, p.id]));
    const rowFor = (week: number) => {
      const had = rows.get(week);
      if (had) return had;
      const id = nanoid(10);
      tx.insert(s.parts).values({ id, projectId, key: weekKey(week), title: titles.get(week) ?? "", week, position: week, breakdownStatus: approved ? "approved" : "proposed", approvedAt: approved ? Date.now() : null }).run();
      rows.set(week, id);
      return id;
    };

    const next = new Map<string, number>();
    for (const { l, week } of placed) {
      const partId = rowFor(week!);
      const position = next.get(partId) ?? 0;
      next.set(partId, position + 1);
      tx.update(s.layers).set({ partId, position }).where(eq(s.layers.id, l.id)).run();
    }

    // each Part synthesis goes to the last week of that Part
    for (const part of old) {
      const ws = placed.filter((x) => x.part.id === part.id).map((x) => x.week!);
      const has = tx.select({ id: s.writebacks.id }).from(s.writebacks).where(and(eq(s.writebacks.targetType, "part"), eq(s.writebacks.targetId, part.id))).get()
        ?? tx.select({ id: s.layerMessages.id }).from(s.layerMessages).where(and(eq(s.layerMessages.targetType, "part"), eq(s.layerMessages.targetId, part.id))).get();
      if (!has && !ws.length) continue;
      const to = rowFor(ws.length ? Math.max(...ws) : Math.max(1, ...placed.map((x) => x.week!)));
      moveSynthesis(tx, projectId, part.id, to);
    }
    tx.delete(s.parts).where(inArray(s.parts.id, old.map((p) => p.id))).run();
  });
  return true;
}

/** Re-point a Part synthesis at a week. If that week already has a saved synthesis, the newer save is kept; quick notes are joined. */
function moveSynthesis(tx: Db, projectId: string, from: string, to: string) {
  const at = (id: string) => and(eq(s.writebacks.targetType, "part"), eq(s.writebacks.targetId, id));
  tx.update(s.writebacks).set({ targetId: to }).where(at(from)).run();
  tx.update(s.layerMessages).set({ targetId: to }).where(and(eq(s.layerMessages.targetType, "part"), eq(s.layerMessages.targetId, from))).run();

  const save = (id: string) => tx.select().from(s.noteSaves).where(and(eq(s.noteSaves.targetType, "part"), eq(s.noteSaves.targetId, id))).get();
  const moving = save(from);
  const there = save(to);
  if (moving && there) {
    if (moving.savedAt > there.savedAt) {
      tx.delete(s.noteSaves).where(eq(s.noteSaves.id, there.id)).run();
      tx.update(s.noteSaves).set({ targetId: to }).where(eq(s.noteSaves.id, moving.id)).run();
    } else tx.delete(s.noteSaves).where(eq(s.noteSaves.id, moving.id)).run();
  } else if (moving) tx.update(s.noteSaves).set({ targetId: to }).where(eq(s.noteSaves.id, moving.id)).run();

  const note = (id: string) => tx.select().from(s.quickNotes).where(and(eq(s.quickNotes.projectId, projectId), eq(s.quickNotes.targetType, "part"), eq(s.quickNotes.targetId, id))).get();
  const qn = note(from);
  if (!qn) return;
  const qt = note(to);
  const where = (id: string) => and(eq(s.quickNotes.projectId, projectId), eq(s.quickNotes.targetType, "part"), eq(s.quickNotes.targetId, id));
  if (qt) {
    tx.update(s.quickNotes).set({ text: `${qt.text}\n\n${qn.text}`, updatedAt: Math.max(qt.updatedAt, qn.updatedAt) }).where(where(to)).run();
    tx.delete(s.quickNotes).where(where(from)).run();
  } else tx.update(s.quickNotes).set({ targetId: to }).where(where(from)).run();
}

/** Every course in the database, moved to weeks where it still has Parts. Run once when the app's database opens. */
export function migrateAllToWeeks(db: Db) {
  // a database whose migrations haven't reached the weeks round yet (the app folder is older than the code) has nothing to move to
  const columns = db.all<{ name: string }>(sql`pragma table_info(parts)`).map((c) => c.name);
  if (!columns.includes("week")) return;
  const ids = db.selectDistinct({ id: s.parts.projectId }).from(s.parts).where(isNull(s.parts.week)).all().map((r) => r.id);
  for (const id of ids) migratePartsToWeeks(db, id);
}
