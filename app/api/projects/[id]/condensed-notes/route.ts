import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { readBody } from "@/lib/projects/api";
import { condensedSchema, getCondensed, saveCondensed } from "@/lib/talk/condensed";

const missing = () => Response.json({ error: "That project no longer exists. Go back to Your projects." }, { status: 404 });
const exists = (id: string) => getDb().select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, id)).get() !== undefined;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return missing();
  return Response.json({ text: getCondensed(getDb(), id) });
}

/** Autosave the condensed notes. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!exists(id)) return missing();
  const body = await readBody(req, condensedSchema);
  if ("error" in body) return body.error;
  return Response.json({ text: saveCondensed(getDb(), id, body.data.text) });
}
