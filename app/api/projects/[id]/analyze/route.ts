import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { refuseIfDemo } from "@/lib/projects/demo-guard";
import { analyzeProject } from "@/lib/projects/service";

export const maxDuration = 600;

/**
 * Sort the folder into weeks: the AI reads the syllabus and the files (`analyzeProject`). The answer streams back as lines of JSON, one
 * per step in plain words ({ step }), then { done: true } or { error }. Aborting the request stops the AI call.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/analyze">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      const send = (data: unknown) => {
        try {
          c.enqueue(enc.encode(`${JSON.stringify(data)}\n`));
        } catch {
          // the page went away; the work stops through the request's signal
        }
      };
      try {
        await analyzeProject(getDb(), getEngine(), id, (step) => send({ step }), req.signal);
        send({ done: true });
      } catch (e) {
        send({ error: req.signal.aborted ? "Stopped." : e instanceof Error ? e.message : "Margin couldn't sort these files. Try again." });
      }
      try {
        c.close();
      } catch {
        // already closed by a cancel
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" } });
}
