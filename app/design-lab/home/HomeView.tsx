"use client";

import Lenis from "lenis";
import { animate, motion, useMotionValue, useScroll, useTransform } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DevToggle } from "@/components/cinematic/Agents";
import { Hall } from "@/components/cinematic/Hall";
import { useAgents } from "@/components/cinematic/agentState";
import { Backdrop } from "@/components/cinematic/Backdrop";
import { Curtain, type CurtainMode } from "@/components/cinematic/Curtain";
import { rgbCss, unitAccents, unitMotifs, type RGB } from "@/components/cinematic/theme";
import { transit, type Rect } from "@/components/cinematic/transit";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { projects, type Project } from "./projects";

const OVERVIEW = "/design-lab/overview";
const SETTLE = [0.23, 1, 0.32, 1] as const;

const INK_WORDS =
  "Your courses, one section at a time. Read the real text, see why it matters, and work through it with a tutor that knows your files.".split(" ");

function partOfDay(h: number) {
  return h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

type Cover = { mode: CurtainMode; rect: Rect | null; accent: RGB; next?: string };

export function HomeView() {
  const reduced = useReducedSafe();
  const router = useRouter();
  const lenis = useRef<Lenis | null>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const tiles = useRef<Record<string, HTMLElement | null>>({});
  const [cover, setCover] = useState<Cover | null>(null);
  const [greeting, setGreeting] = useState("");
  const { mode } = useAgents();

  const accents = useMemo(() => projects.map((p) => unitAccents(p.title, 1)[0]), []);
  const motifs = useMemo(() => projects.map((p) => unitMotifs(p.title, 1)[0]), []);
  const pos = useMotionValue(0);

  useEffect(() => setGreeting(`Good ${partOfDay(new Date().getHours())}.`), []);

  // The landing page is part of the cinematic layer, so it gets smooth scrolling too.
  useEffect(() => {
    if (reduced) return;
    const instance = new Lenis({ autoRaf: true, lerp: 0.09 });
    lenis.current = instance;
    return () => {
      instance.destroy();
      lenis.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    router.prefetch(OVERVIEW);
  }, [router]);

  // Coming back from a project: land on its tile and shrink the project's colour back into it.
  // Next keeps routes alive, so this runs again each time the page is shown.
  useLayoutEffect(() => {
    let raf = 0;
    if (transit.dir === "out" && !reduced && tiles.current[transit.projectId] && projectsRef.current) {
      const id = transit.projectId;
      const i = Math.max(0, projects.findIndex((p) => p.id === id));
      pos.set(i);
      // Hold the screen in the project's colour while the page settles: Next resets the scroll after
      // navigating, so the tile is measured one frame later, where it really is.
      setCover({ mode: "hold", rect: null, accent: accents[i] });
      const settle = () => window.scrollTo(0, projectsRef.current!.offsetTop);
      settle();
      raf = requestAnimationFrame(() => {
        settle();
        raf = requestAnimationFrame(() => {
          const r = tiles.current[id]!.getBoundingClientRect();
          setCover({ mode: "contract", rect: { x: r.left, y: r.top, w: r.width, h: r.height }, accent: accents[i] });
        });
      });
    } else if (transit.dir === "out") {
      transit.dir = null;
    }
    // Hidden or unmounted: drop any curtain, so a stale one never replays when the page returns.
    return () => {
      cancelAnimationFrame(raf);
      setCover(null);
    };
  }, [reduced, accents, pos]);

  const open = (p: Project, i: number) => {
    const el = tiles.current[p.id];
    transit.projectId = p.id;
    transit.dir = "in";
    if (reduced || !el) {
      router.push(`${OVERVIEW}?project=${p.id}`);
      return;
    }
    lenis.current?.stop();
    const r = el.getBoundingClientRect();
    transit.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    setCover({ mode: "expand", rect: transit.rect, accent: accents[i], next: `${OVERVIEW}?project=${p.id}` });
  };

  const hover = (i: number | null) => {
    if (reduced || i === null) return;
    animate(pos, i, { duration: 1.4, ease: SETTLE });
  };

  const due = 3;

  return (
    <div className="ov ho">
      <Backdrop seed="margin:home" accents={accents} motifs={motifs} pos={pos} reduced={reduced} />
      <main className="ho-main">
        <Hero reduced={reduced} greeting={greeting} due={due} />
        <section className="ho-projects" ref={projectsRef} aria-labelledby="ho-projects-h">
          <div className="ho-projects-head">
            <h2 id="ho-projects-h">Your projects</h2>
            <p>
              <button type="button">Review today ({due})</button>
              <button type="button">Notes</button>
            </p>
          </div>
          <div className="ho-grid">
            {projects.map((p, i) => (
              <Tile
                key={p.id}
                project={p}
                accent={accents[i]}
                index={i}
                mode={p.example ? "idle" : mode}
                reduced={reduced}
                tileRef={(el) => void (tiles.current[p.id] = el)}
                onOpen={() => open(p, i)}
                onHover={hover}
              />
            ))}
            <NewTile />
          </div>
        </section>
      </main>
      <DevToggle />
      {cover && (
        <Curtain
          mode={cover.mode}
          rect={cover.rect}
          accent={cover.accent}
          onDone={() => {
            if (cover.next) router.push(cover.next);
            else {
              transit.dir = null;
              setCover(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Headline push-in for the wordmark, ink reveal for the description, then a quiet greeting. */
function Hero({ reduced, greeting, due }: { reduced: boolean; greeting: string; due: number }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(p, [0, 0.8], [1, 1.45]);
  const opacity = useTransform(p, [0.25, 0.75], [1, 0]);
  return (
    <section className="ho-hero" ref={ref} aria-label="Margin">
      <motion.div className="ho-hero-in" style={reduced ? undefined : { scale, opacity }}>
        <motion.h1
          className="ho-word"
          initial={reduced ? false : { scale: 2.4, opacity: 0, y: 60 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 1.25, ease: SETTLE }}
          style={{ transformOrigin: "0 100%" }}
        >
          Margin.
        </motion.h1>
        <p className="ho-ink" aria-label={INK_WORDS.join(" ")}>
          {INK_WORDS.map((w, i) => (
            <span key={i} className="ho-ink-w" aria-hidden="true" style={{ animationDelay: `${reduced ? 0 : 900 + i * 55}ms` }}>
              {w}{" "}
            </span>
          ))}
        </p>
        <p className="ho-greet" style={{ animationDelay: reduced ? "0ms" : `${900 + INK_WORDS.length * 55 + 250}ms` }}>
          {greeting} {due} sections are due for review today.
        </p>
      </motion.div>
    </section>
  );
}

function Tile({
  project: p,
  accent,
  index,
  mode,
  reduced,
  tileRef,
  onOpen,
  onHover,
}: {
  project: Project;
  accent: RGB;
  index: number;
  mode: "idle" | "busy" | "done";
  reduced: boolean;
  tileRef: (el: HTMLElement | null) => void;
  onOpen: () => void;
  onHover: (i: number | null) => void;
}) {
  const total = p.counts.solid + p.counts.shaky + p.counts.new;
  const cells = ([["solid", p.counts.solid], ["shaky", p.counts.shaky], ["new", p.counts.new]] as const).filter(([, n]) => n > 0);
  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width - 0.5).toFixed(3)}`);
    e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height - 0.5).toFixed(3)}`);
  };
  return (
    <article
      className="ho-tile"
      data-big={index === 0 ? "" : undefined}
      ref={tileRef}
      style={{ ["--unit" as string]: rgbCss(accent), ["--wash" as string]: rgbCss(accent, 0.3) }}
      onPointerMove={move}
      onPointerEnter={() => onHover(index)}
    >
      <div className="ho-hall">
        <Hall mode={mode} accent={accent} focus={index === 0 ? [0.66, 0.64] : [0.78, 0.5]} reduced={reduced} caption="Back at the table. Their work is waiting inside." />
      </div>
      <div className="ho-tile-body">
        <p className="ho-code">
          {p.code}
          {p.example && <span className="ho-example">Example, not your files</span>}
        </p>
        <h3>
          <button type="button" className="ho-open" onClick={onOpen}>
            {p.title}
          </button>
        </h3>
        <div className="ho-progress">
          <div className="ov-bar" role="img" aria-label={`${p.counts.solid} solid, ${p.counts.shaky} shaky, ${p.counts.new} new, of ${total} sections`}>
            {cells.map(([s, n]) => (
              <i key={s} className="ov-cell static" data-status={s} style={{ flex: n }} />
            ))}
          </div>
          <p className="ov-counts">
            <span><b>{p.counts.solid}</b> solid</span>
            <span><b>{p.counts.shaky}</b> shaky</span>
            <span><b>{p.counts.new}</b> new</span>
          </p>
        </div>
        <p className="ho-resume">
          Continue where you left off:
          <br />
          <span>{p.resume.label}</span>
        </p>
      </div>
    </article>
  );
}

function NewTile() {
  return (
    <article className="ho-tile ho-new">
      <svg className="ho-new-mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M6 12a3 3 0 0 1 3-3h7l3 4h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M20 19v8M16 23h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div>
        <h3>
          <button type="button" className="ho-open" onClick={() => undefined}>New project</button>
        </h3>
        <p>Drop in a course folder: PDFs, Word, PowerPoint or notes. Margin splits each file into sections that follow its own structure.</p>
      </div>
    </article>
  );
}
