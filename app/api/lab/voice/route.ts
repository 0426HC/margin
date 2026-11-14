import fs from "node:fs";
import path from "node:path";
import { REF_NAME, SERVER, VOICE_DIR, configSchema, demoParagraph, readConfig, writeConfig } from "@/lib/voice/lab";

const off = () => (process.env.NODE_ENV === "production" ? Response.json({ error: "The voice lab only runs in dev." }, { status: 404 }) : null);

/** What the lab page needs: is the local voice server up, is the voice file there, the saved choice, and the paragraph. */
export async function GET() {
  const refused = off();
  if (refused) return refused;
  const server = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => (r.ok ? (r.json() as Promise<{ device: string }>) : null))
    .catch(() => null);
  return Response.json({
    server: server ? { up: true, device: server.device } : { up: false },
    refPresent: fs.existsSync(path.join(VOICE_DIR, "refs", REF_NAME)),
    config: readConfig(),
    paragraph: demoParagraph(),
  });
}

/** Save the chosen voice and its settings to .data/voice/config.json. */
export async function PUT(req: Request) {
  const refused = off();
  if (refused) return refused;
  const parsed = configSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't a valid voice setting." }, { status: 400 });
  writeConfig(parsed.data);
  return Response.json({ config: parsed.data });
}

