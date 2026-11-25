import { getDb } from "@/lib/db/client";
import { writingStatus } from "@/lib/layers/background";

/** How many of the course's layers are written ("12 of 18 layers ready"), and whether background writing waits for the usage limit. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return Response.json(writingStatus(getDb(), id), { headers: { "cache-control": "no-store" } });
}
