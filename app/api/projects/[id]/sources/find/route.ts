import { getEngine } from "@/lib/ai";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { collectTalkSources } from "@/lib/talk/sources";

export const maxDuration = 300;

/**
 * Ask the Librarian to collect sources from what was discussed. It is called by the "Find sources now" button, and by the page
 * when the student leaves Let's talk! or closes the tab (sendBeacon), so it does not stop when the request is dropped.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/sources/find">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await collectTalkSources(getDb(), getEngine(), id));
  } catch (e) {
    return failure(e);
  }
}
