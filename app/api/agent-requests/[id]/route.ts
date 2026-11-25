import { deleteRequest, getDocument } from "@/lib/agents/requests";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";

export async function GET(_req: Request, ctx: RouteContext<"/api/agent-requests/[id]">) {
  const { id } = await ctx.params;
  const doc = getDocument(getDb(), id);
  return doc ? Response.json(doc) : fail("That document no longer exists.", 404);
}

/** Delete a document for good. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/agent-requests/[id]">) {
  const { id } = await ctx.params;
  return deleteRequest(getDb(), id) ? Response.json({ ok: true }) : fail("That document no longer exists.", 404);
}
