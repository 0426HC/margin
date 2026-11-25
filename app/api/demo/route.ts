import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { demoSeedSchema, importDemoSeed } from "@/lib/demo/seed";
import { fail } from "@/lib/projects/api";

const SEED = path.join(process.cwd(), "demo", "seed.json");

/** Open the demo course: created from the committed seed the first time, then reused. */
export async function POST() {
  if (!fs.existsSync(SEED)) return fail("The demo course hasn't been built yet. Run `npm run demo:build` once, then try again.", 404);
  const seed = demoSeedSchema.safeParse(JSON.parse(fs.readFileSync(SEED, "utf8")));
  if (!seed.success) return fail("The demo seed file is damaged. Run `npm run demo:build` to rebuild it.", 500);
  return Response.json({ id: importDemoSeed(getDb(), seed.data) });
}
