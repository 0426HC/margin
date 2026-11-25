import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { requestLayer } from "@/lib/layers/background";
import { failure, failureBody } from "@/lib/layers/http";
import { watchProgress } from "@/lib/layers/layer-progress";

export const maxDuration = 600;

/**
 * The student opened a layer that isn't written yet: it goes to the front of the background queue (lib/layers/background.ts) and this
 * answer follows it until it is written. 409 until the course plan is approved. The answer is a stream
 * of JSON lines: {type:"progress"} while it works (which step it is on), then {type:"done"} or {type:"error", error, code}. The work does
 * not depend on the page staying open: leaving the layer lets it finish and be saved, and coming back picks up its progress.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/layers/[id]/write">) {
  const { id } = await ctx.params;
  let job: Promise<void>;
  try {
    job = requestLayer(getDb(), getEngine(), id);
  } catch (e) {
    return failure(e);
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
      const unwatch = watchProgress(id, (progress) => send({ type: "progress", progress, now: Date.now() }));
      job
        .then(
          () => send({ type: "done" }),
          (e: unknown) => send({ type: "error", ...failureBody(e) }),
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
      // the student left the page: the work goes on and is saved
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
