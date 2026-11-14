"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { VERSIONS, type VersionId, type VoiceConfig } from "@/lib/voice/versions";

interface Info {
  server: { up: boolean; device?: string };
  refPresent: boolean;
  config: VoiceConfig | null;
  paragraph: string;
}
interface Made {
  url: string;
  synth: number;
  audio: number;
}

const IDS: VersionId[] = [1, 2, 3];
const SETTINGS: Record<VersionId, VoiceConfig> = {
  1: { engine: "chatterbox", voice: "default", exaggeration: VERSIONS[1].exaggeration, cfgWeight: VERSIONS[1].cfgWeight },
  2: { engine: "chatterbox", voice: "default", exaggeration: VERSIONS[2].exaggeration, cfgWeight: VERSIONS[2].cfgWeight },
  3: { engine: "chatterbox", voice: "voice.wav", exaggeration: VERSIONS[3].exaggeration, cfgWeight: VERSIONS[3].cfgWeight },
};
const same = (a: VoiceConfig | null, b: VoiceConfig) => !!a && a.voice === b.voice && a.exaggeration === b.exaggeration && a.cfgWeight === b.cfgWeight;

export function VoiceLab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [made, setMade] = useState<Partial<Record<VersionId | "speed", Made>>>({});
  const [busy, setBusy] = useState<VersionId | "speed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  const load = useCallback(async () => setInfo((await fetch("/api/lab/voice").then((r) => r.json()).catch(() => null)) as Info | null), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 4000);
    const held = urls.current;
    return () => {
      clearInterval(t);
      held.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [load]);

  const make = async (version: VersionId, speed = false) => {
    const key = speed ? "speed" : version;
    setBusy(key);
    setError(null);
    try {
      const r = await fetch("/api/lab/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, speed }) });
      if (!r.ok) return setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work.");
      const url = URL.createObjectURL(await r.blob());
      urls.current.push(url);
      setMade((m) => ({ ...m, [key]: { url, synth: Number(r.headers.get("x-synth-seconds")), audio: Number(r.headers.get("x-audio-seconds")) } }));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (id: VersionId) => {
    const r = await fetch("/api/lab/voice", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(SETTINGS[id]) });
    if (r.ok) {
      setSaved(`Saved: ${VERSIONS[id].label}. It is in .data/voice/config.json; change it there, or pick again here.`);
      void load();
    } else setError("Couldn't save the choice.");
  };

  const up = info?.server.up;
  return (
    <main className="m-desk" style={{ minHeight: "100dvh", padding: "40px 24px 80px", color: "var(--panel-ink)" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 24 }}>
        <header>
          <h1 className="t-h1" style={{ margin: 0 }}>
            Voice lab
          </h1>
          <p className="t-ui" style={{ color: "var(--panel-muted)", margin: "6px 0 0" }}>
            One layer paragraph, three voices. Listen to each, then pick one. Everything runs on this laptop.
          </p>
          <p className="t-label" style={{ color: "var(--panel-muted)", margin: "10px 0 0" }} role="status">
            {!info
              ? "Checking the voice server…"
              : up
                ? `Chatterbox is running on ${info.server.device}.`
                : "The voice server isn't running. In a terminal: .data/voice/venv/bin/python scripts/voice/server.py (the first start loads the model and takes a minute)."}
            {info && !info.refPresent ? " Your voice file .data/voice/refs/voice.wav is missing, so version 3 can't be made." : ""}
          </p>
        </header>

        <section className="m-paper" style={{ padding: "22px 26px", borderRadius: "var(--radius)" }} aria-label="The paragraph that is read">
          <p className="t-label" style={{ margin: "0 0 8px", color: "var(--ink-muted)" }}>
            The paragraph (from the demo, citation left out)
          </p>
          <p style={{ margin: 0, fontFamily: "var(--font-text)", fontSize: "var(--text-read)", lineHeight: "var(--leading-read)", color: "var(--ink)" }}>{info?.paragraph ?? "…"}</p>
        </section>

        {error && (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {saved && (
          <p className="t-ui" role="status" style={{ margin: 0 }}>
            {saved}
          </p>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {IDS.map((id) => {
            const v = VERSIONS[id];
            const m = made[id];
            const disabled = !up || busy !== null || (v.custom && !info?.refPresent);
            return (
              <section key={id} className="m-panel surface-desk" style={{ padding: "16px 18px", display: "grid", gap: 10 }} aria-label={`Version ${id}: ${v.label}`}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <h2 className="t-h3" style={{ margin: 0 }}>
                    {id}. {v.label}
                  </h2>
                  <span className="t-label" style={{ color: "var(--panel-muted)" }}>
                    expressiveness {v.exaggeration}, pacing weight {v.cfgWeight}
                    {v.custom ? ", voice: voice.wav" : ""}
                  </span>
                </div>
                <div className="m-act-row" style={{ alignItems: "center" }}>
                  <Button variant="accent" onClick={() => void make(id)} disabled={disabled}>
                    {busy === id ? "Making it…" : m ? "Make it again" : "Make this version"}
                  </Button>
                  <Button onClick={() => void pick(id)} disabled={!m}>
                    {same(info?.config ?? null, SETTINGS[id]) ? "This is your pick" : "Pick this voice"}
                  </Button>
                  {m && (
                    <span className="t-label" style={{ color: "var(--panel-muted)" }}>
                      {m.audio.toFixed(1)} s of audio, made in {m.synth.toFixed(1)} s
                    </span>
                  )}
                </div>
                {m && <audio controls src={m.url} style={{ width: "100%" }} aria-label={`Version ${id} audio`} />}
              </section>
            );
          })}
        </div>

        <section className="m-panel surface-desk" style={{ padding: "14px 18px", display: "grid", gap: 8 }} aria-label="Speed check">
          <h2 className="t-h3" style={{ margin: 0 }}>
            Speed check
          </h2>
          <p className="t-ui" style={{ margin: 0, color: "var(--panel-muted)" }}>
            One short sentence in the default voice, to see how long a single sentence takes. The plan wants first sound within about 1.5 s.
          </p>
          <div className="m-act-row" style={{ alignItems: "center" }}>
            <Button onClick={() => void make(1, true)} disabled={!up || busy !== null}>
              {busy === "speed" ? "Timing…" : "Time one sentence"}
            </Button>
            {made.speed && (
              <span className="t-label" style={{ color: "var(--panel-muted)" }}>
                {made.speed.audio.toFixed(1)} s of audio, made in {made.speed.synth.toFixed(1)} s
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
