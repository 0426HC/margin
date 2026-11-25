import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { fail, readBody } from "@/lib/projects/api";
import { createProject } from "@/lib/projects/service";

const body = z.object({ name: z.string().trim().min(1, "Give the project a name."), courseCode: z.string().trim().max(20).optional() });

export async function POST(req: Request) {
  const r = await readBody(req, body);
  if ("error" in r) return r.error;
  try {
    return Response.json({ id: createProject(getDb(), r.data) }, { status: 201 });
  } catch {
    return fail("Margin couldn't create the project. Check that its data folder is writable.", 500);
  }
}
