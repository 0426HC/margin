import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { dontGetItSynthesis } from "@/lib/layers/writeback";
import { readBody } from "@/lib/projects/api";

export const maxDuration = 300;

/** "I don't get it" on a synthesis: how the layers connect is explained again, more simply, streamed as server-sent events. Aborting the request stops the model. */
export async function POST(req: Request, ctx: RouteContext<"/api/parts/[id]/synthesis/dont-get-it">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ confusion: z.string().max(4000).optional() }));
  if ("error" in body) return body.error;
  const enc = new TextEncoder();
  const gen = dontGetItSynthesis(getDb(), getEngine(), id, body.data.confusion, req.signal);
  // Pull the first chunk before answering, so a gate or engine error is a normal JSON error and not a half-open stream.
  let first: IteratorResult<Awaited<ReturnType<typeof gen.next>>["value"]>;
  try {
    first = await gen.next();
  } catch (e) {
    return failure(e);
  }
  const send = (c: ReadableStreamDefaultController, event: string, data: unknown) => c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const stream = new ReadableStream({
    async start(c) {
      try {
        let step = first;
        while (!step.done) {
          send(c, step.value.type, step.value);
          step = await gen.next();
        }
      } catch (e) {
        send(c, "error", { error: e instanceof Error ? e.message : "The explanation stopped early. Try again." });
      }
      c.close();
    },
    cancel() {
      void gen.return(undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
