import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";
import { deleteTalkMessage } from "@/lib/talk/service";

/** Delete one message of a conversation for good. A question is deleted together with its reply. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]/talk/messages/[messageId]">) {
  const { id, messageId } = await ctx.params;
  const deleted = deleteTalkMessage(getDb(), id, messageId);
  return deleted ? Response.json({ deleted }) : fail("That message is already gone. Reload the conversation.", 404);
}
