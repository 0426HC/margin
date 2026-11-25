import { z } from "zod";
import { listTasks, markSeen } from "@/lib/agents/tasks";
import { getDb } from "@/lib/db/client";
import { readBody } from "@/lib/projects/api";

/** Which agents are busy for this project, and what finished that the student hasn't dismissed yet. */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/agent-tasks">) {
  const { id } = await ctx.params;
  const { running, unseen } = listTasks(getDb(), id);
  const pick = (t: (typeof running)[number]) => ({ id: t.id, agent: t.agent, kind: t.kind, summary: t.summary, result: t.result });
  return Response.json({ running: running.map(pick), unseen: unseen.map(pick) });
}

/** Dismiss "While you were away". */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/agent-tasks">) {
  const { id } = await ctx.params;
  const body = await readBody(req, z.object({ ids: z.array(z.string()).optional() }));
  if ("error" in body) return body.error;
  markSeen(getDb(), id, body.data.ids);
  return Response.json({ ok: true });
}
