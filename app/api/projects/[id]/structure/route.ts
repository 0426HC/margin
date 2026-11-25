import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { failure } from "@/lib/layers/http";
import { addOptionalLayer, mergeWithNext, moveLayer, moveLayerToWeek, renameWeek, splitLayer, updateLayer } from "@/lib/layers/service";
import { readBody } from "@/lib/projects/api";
import { refuseIfDemo } from "@/lib/projects/demo-guard";

const edit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update"), layerId: z.string(), title: z.string().max(80).optional(), bigQuestion: z.string().max(220).optional(), buildsOn: z.string().max(240).optional() }),
  z.object({ op: z.literal("merge"), layerId: z.string() }),
  z.object({ op: z.literal("split"), layerId: z.string() }),
  z.object({ op: z.literal("move"), layerId: z.string(), direction: z.enum(["up", "down"]) }),
  z.object({ op: z.literal("moveToWeek"), layerId: z.string(), week: z.number().int().min(1).max(60) }),
  z.object({ op: z.literal("renameWeek"), weekId: z.string(), title: z.string().max(70) }),
  z.object({ op: z.literal("addOptional"), fileId: z.string() }),
]);

/** Edit the plan: layers (rename, big question, merge, split, move up or down, move to another week) and a week's topic. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]/structure">) {
  const { id } = await ctx.params;
  const refused = refuseIfDemo(getDb(), { projectId: id });
  if (refused) return refused;
  const body = await readBody(req, edit);
  if ("error" in body) return body.error;
  const db = getDb();
  const e = body.data;
  try {
    if (e.op === "update") updateLayer(db, e.layerId, e);
    else if (e.op === "merge") mergeWithNext(db, e.layerId);
    else if (e.op === "split") splitLayer(db, e.layerId);
    else if (e.op === "move") moveLayer(db, e.layerId, e.direction);
    else if (e.op === "moveToWeek") moveLayerToWeek(db, e.layerId, e.week);
    else if (e.op === "renameWeek") renameWeek(db, e.weekId, e.title);
    else addOptionalLayer(db, id, e.fileId);
    return Response.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
