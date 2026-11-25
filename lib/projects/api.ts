import { z } from "zod";

/** Parse a JSON body with Zod. Returns the data, or a 400 response that says what was wrong. */
export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: Response }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return { error: Response.json({ error: parsed.error.issues.map((i) => i.message).join(" ") }, { status: 400 }) };
}

export const fail = (message: string, status = 400) => Response.json({ error: message }, { status });
