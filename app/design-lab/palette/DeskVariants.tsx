"use client";

import { useEffect, useRef } from "react";
import { hashSeed, rng } from "@/components/cinematic/theme";

/**
 * Stars and constellation lines, drawn once onto an oversized canvas. The drift is a slow CSS transform on that canvas,
 * so it runs on the compositor and costs nothing per frame. Reduced motion: no drift.
 */
function Starfield({ seed }: { seed: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    const c = el?.getContext("2d");
    if (!el || !c) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = el.clientWidth;
      const h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const r = rng(hashSeed(seed));
      const stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({ x: r() * w, y: r() * h, s: r() }));
      // constellations: a few short chains between nearby stars
      c.lineWidth = 0.8;
      c.strokeStyle = "rgb(150 170 220 / 0.16)";
      for (let k = 0; k < 9; k++) {
        let a = stars[Math.floor(r() * stars.length)];
        c.beginPath();
        c.moveTo(a.x, a.y);
        for (let j = 0; j < 4; j++) {
          const b = stars.filter((s) => s !== a && Math.hypot(s.x - a.x, s.y - a.y) < 140).sort(() => r() - 0.5)[0];
          if (!b) break;
          c.lineTo(b.x, b.y);
          a = b;
        }
        c.stroke();
      }
      for (const s of stars) {
        c.fillStyle = `rgb(220 228 248 / ${0.18 + s.s * 0.5})`;
        c.beginPath();
        c.arc(s.x, s.y, 0.5 + s.s * 1.1, 0, Math.PI * 2);
        c.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [seed]);
  return <canvas ref={ref} className="dv-stars" aria-hidden="true" />;
}

const VARIANTS = [
  {
    id: "lamp",
    name: "1. Overhead lamp",
    note: "Lighter navy-indigo pooled at the top centre, falling to deep navy at the edges and bottom. A faint plum glow in the top-left corner.",
  },
  {
    id: "horizon",
    name: "2. Night horizon",
    note: "A vertical fall from navy-indigo at the top to near-black navy at the bottom, darker at the sides. A faint plum glow low in the bottom-right corner.",
  },
];

export function DeskVariants() {
  return (
    <section className="dv" aria-labelledby="dv-h">
      <div className="pl-palette-head">
        <h2 id="dv-h">Midnight desk: pick a gradient</h2>
        <p>Both stay in the navy family. The plum is a single low-opacity corner glow, never a purple-to-blue sweep. Stars drift very slowly and stop under reduced motion.</p>
      </div>
      <div className="dv-grid">
        {VARIANTS.map((v) => (
          <figure key={v.id}>
            <div className="dv-desk" data-variant={v.id}>
              <Starfield seed={`margin:${v.id}`} />
              <div className="dv-content">
                <b className="dv-word">Margin.</b>
                <p className="dv-title">Your projects</p>
                <div className="dv-cards">
                  {["The Federalist Papers", "Comparative political economy", "Europe after 1945"].map((t) => (
                    <div key={t} className="dv-card">
                      <span>POL</span>
                      <b>{t}</b>
                    </div>
                  ))}
                </div>
                <div className="dv-sheet">
                  <b>Note to Self</b>
                  <span>Paper on the desk, to judge the contrast of the sheet against the gradient.</span>
                </div>
              </div>
            </div>
            <figcaption>
              <b>{v.name}</b> {v.note}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
