import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failureBody } from "@/lib/layers/http";
import { weekKey, watchLecture } from "@/lib/lecture/progress";
import { getWeekLecture, writeWeekLecture } from "@/lib/lecture/service";
import { fail } from "@/lib/projects/api";
import { validWeek } from "@/lib/weeks/notes";

export const maxDuration = 600;

/**
 * The student opened a week's Lecture tab: any section missing or out of date is written now, ahead of background work (or joined, if the
 * background is already writing it). The answer is a stream of JSON lines: {type:"progress", writing} with each section's text so far,
 * then {type:"done", tab} with what is stored, plus `error` if a section could not be written (its old text stays). Leaving the page
 * lets the writing finish and be saved.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/weeks/[week]/lecture">) {
  const { id, week: w } = await ctx.params;
  const week = Number(w);
  if (!validWeek(week)) return fail("That isn't a week of the course.", 404);
  const db = getDb();
  let job: Promise<void>;
  try {
    job = writeWeekLecture(db, getEngine(), id, week, { priority: "now" });
  } catch (e) {
    job = Promise.reject(e);
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (o: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          open = false;
        }
      };
      const unwatch = watchLecture(weekKey(id, week), (p) => send({ type: "progress", writing: p.writing }));
      job
        .then(
          () => send({ type: "done", tab: getWeekLecture(db, id, week) }),
          (e: unknown) => send({ type: "done", tab: getWeekLecture(db, id, week), error: failureBody(e).error }),
        )
        .finally(() => {
          unwatch();
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {}
        });
    },
    cancel() {
      // the student left: the writing goes on and is saved
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
