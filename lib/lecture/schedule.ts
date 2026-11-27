import type { Engine } from "@/lib/ai/engine";
import { UsageLimitReached } from "@/lib/ai/errors";
import type { Db } from "@/lib/db/client";
import { GateError } from "@/lib/layers/service";
import { weekKey } from "./progress";
import { lectureQuietMs, noteLeft, writeWeekLecture } from "./service";

/**
 * When the "From your lecture notes" section is written again: never on a keystroke, but once the student has stopped editing that week's
 * Lecture notes for the quiet time (3 minutes), or at once when they leave the Lecture notes page. Each save of a week's notes starts its
 * clock again. The timers live on globalThis (the routes load their own copy of this module); after a restart the background lane finds
 * the out-of-date section itself (`nextLectureWeek`).
 */

const timers = ((globalThis as unknown as Record<string, Map<string, ReturnType<typeof setTimeout>>>).__margin_lecture_timers__ ??= new Map());

function write(db: Db, engine: Engine, projectId: string, week: number) {
  try {
    void writeWeekLecture(db, engine, projectId, week, { priority: "background" }).catch((e: unknown) => {
      if (!(e instanceof UsageLimitReached)) console.log(`[margin lecture] week ${week} notes section not written (${e instanceof Error ? e.name : "Failed"}); written when the tab is opened`);
    });
  } catch (e) {
    if (!(e instanceof GateError)) throw e;
  }
}

/** The student saved a week's notes (`left`: on leaving the page). The notes section is written again after the quiet time, or now if they left. */
export function notesSaved(db: Db, engine: Engine, projectId: string, week: number, { left = false }: { left?: boolean } = {}) {
  const key = weekKey(projectId, week);
  clearTimeout(timers.get(key));
  timers.delete(key);
  if (left) {
    noteLeft(projectId, week);
    return write(db, engine, projectId, week);
  }
  const t = setTimeout(() => {
    timers.delete(key);
    write(db, engine, projectId, week);
  }, lectureQuietMs());
  t.unref?.();
  timers.set(key, t);
}
