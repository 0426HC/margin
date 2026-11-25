import { z } from "zod";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { clearTalk, getTalk, talk } from "@/lib/talk/service";
import { readBody } from "@/lib/projects/api";

export const maxDuration = 300;

/** Let's talk!'s saved history for this project. */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/talk">) {
  const { id } = await ctx.params;
  const channel = new URL(req.url).searchParams.get("channel") === "note" ? "note" : "talk";
  return Response.json({ messages: getTalk(getDb(), id, channel) });
}

/** Ask the professor a question about any of the project's files. The answer streams back as server-sent events; aborting stops the model. */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/talk">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ question: z.string().trim().min(1, "Type a question first.").max(4000), layerId: z.string().optional(), partId: z.string().optional(), topic: z.string().trim().max(4000).optional(), channel: z.enum(["talk", "note"]).optional() }));
  if ("error" in body) return body.error;
  const enc = new TextEncoder();
  const gen = talk(getDb(), getEngine(), id, body.data.question, { layerId: body.data.layerId, partId: body.data.partId, topic: body.data.topic, channel: body.data.channel }, req.signal);
  // Pull the first chunk before answering, so a missing project or an engine error is a normal JSON error and not a half-open stream.
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
        send(c, "error", { error: e instanceof Error ? e.message : "The answer stopped early. Try again." });
      }
      c.close();
    },
    cancel() {
      void gen.return(undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}

/** Clear one whole conversation for good: Let's talk! (the default) or the Note to Self chat (?channel=note). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]/talk">) {
  const { id } = await ctx.params;
  const channel = new URL(req.url).searchParams.get("channel") === "note" ? "note" : "talk";
  return Response.json({ deleted: clearTalk(getDb(), id, channel) });
}
