import { z } from "zod";
import { listRequests, submitRequest } from "@/lib/agents/requests";
import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { readBody } from "@/lib/projects/api";

/** The documents the agents have made (Ready for you), notes still being worked on, and how many notes are left today. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/agent-requests">) {
  const { id } = await ctx.params;
  return Response.json(listRequests(getDb(), id));
}

/**
 * Leave a note for the agents. It is routed to the right agent and answered at once ("started"); the document is made in the background
 * and announced in "While you were away". Graded work is refused kindly with something to do instead.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/agent-requests">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ text: z.string() }));
  if ("error" in body) return body.error;
  try {
    const r = submitRequest(getDb(), getEngine(), id, body.data.text);
    if (r.kind === "refused") return Response.json({ refused: { message: r.message, alternative: r.alternative } });
    void r.done; // the work carries on after this answer
    return Response.json({ started: { id: r.id, agent: r.agent } }, { status: 202 });
  } catch (e) {
    return failure(e);
  }
}
