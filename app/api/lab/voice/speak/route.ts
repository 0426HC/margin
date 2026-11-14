import { z } from "zod";
import { REF_NAME, SERVER, SPEED_SENTENCE, VERSIONS, demoParagraph } from "@/lib/voice/lab";

const body = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3)]), speed: z.boolean().optional() });

/** Make one of the three versions of the paragraph (or, with `speed`, one short sentence in the default voice) and return the audio. Nothing is saved. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "The voice lab only runs in dev." }, { status: 404 });
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "Pick version 1, 2 or 3." }, { status: 400 });
  const v = VERSIONS[b.data.version];
  const r = await fetch(`${SERVER}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: b.data.speed ? SPEED_SENTENCE : demoParagraph(), exaggeration: v.exaggeration, cfg_weight: v.cfgWeight, ref: v.custom ? REF_NAME : null }),
    signal: req.signal,
  }).catch(() => null);
  if (!r) return Response.json({ error: "The local voice server isn't running. Start it with: .data/voice/venv/bin/python scripts/voice/server.py" }, { status: 503 });
  if (!r.ok) return Response.json({ error: ((await r.json().catch(() => null)) as { detail?: string } | null)?.detail ?? "The voice server couldn't make that audio." }, { status: 502 });
  return new Response(r.body, { headers: { "content-type": "audio/wav", "x-synth-seconds": r.headers.get("x-synth-seconds") ?? "", "x-audio-seconds": r.headers.get("x-audio-seconds") ?? "", "cache-control": "no-store" } });
}
