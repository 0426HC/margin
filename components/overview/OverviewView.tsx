"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability -- motion code: it measures the window after mount and drives Motion values imperatively */

import Lenis from "lenis";
import { animate, motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Body, DevToggle, WhileAway, type AwayItem } from "@/components/cinematic/Agents";
import { Backdrop } from "@/components/cinematic/Backdrop";
import { Curtain, type CurtainMode } from "@/components/cinematic/Curtain";
import { Hall } from "@/components/cinematic/Hall";
import { ROT_X, ROT_Z, type Viewport } from "@/components/cinematic/geometry";
import { useAgents, type AgentMode } from "@/components/cinematic/agentState";
import { useAgentTasks } from "@/components/cinematic/useAgentTasks";
import { rgbCss, unitAccents, unitIcons, unitMotifs, type RGB } from "@/components/cinematic/theme";
import { transit } from "@/components/cinematic/transit";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { useUnitPos } from "@/components/cinematic/useUnitPos";
import { arrival, overviewReturn, paperRect } from "@/lib/layout/panes";
import { progressLabel, type ProgressCounts } from "@/lib/layers/progress";
import { TalkScene, type TalkSummary } from "./TalkScene";
import { FlatScene, Scene, SheetPrint, bucketOf, type OpenSection, type SceneLayer, type ScenePart } from "./Scene";

export interface OverviewData {
  project: { id: string; name: string; courseCode: string | null };
  parts: ScenePart[];
  progress: ProgressCounts;
  /** The first layer not yet done. */
  resume: { layerId: string; title: string } | null;
  /** How many layers have a saved version in Note to Self. */
  noted: number;
  /** The Let's talk! section: what is in it. */
  talk: TalkSummary;
}

type Flight = { layer: SceneLayer; cx: number; cy: number; W: number; H: number; tilted: boolean };
const SCENES_AFTER_PARTS = 2; // Let's talk!, then the Note to Self scene
const CSS_STATUS = { saved: "solid", open: "new" } as const;

export function OverviewView({ data }: { data: OverviewData }) {
  const { project, parts, progress, resume, noted, talk } = data;
  const reduced = useReducedSafe();
  const router = useRouter();
  const [vp, setVp] = useState<Viewport>({ w: 1440, h: 900 });
  const [flight, setFlight] = useState<Flight | null>(null);
  const lenis = useRef<Lenis | null>(null);
  const scenes = useRef<(HTMLElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<{ mode: CurtainMode; next?: string } | null>(null);
  const { mode: agentMode } = useAgents();
  const { running, unseen, dismiss } = useAgentTasks(project.id);
  const count = parts.length + SCENES_AFTER_PARTS;
  const title = project.name;

  // Every look is seeded from the project's title: the same course always opens the same way.
  const accents = useMemo(() => unitAccents(title, count), [title, count]);
  const motifs = useMemo(() => unitMotifs(title, count), [title, count]);
  const icons = useMemo(
    () => [...parts.map((p) => unitIcons(`${p.name} ${p.why} ${p.layers.map((l) => `${l.title} ${l.focus}`).join(" ")}`)), unitIcons("let's talk chat sources notepad conversation"), unitIcons("note to self study guide")],
    [parts],
  );
  const pos = useUnitPos(scenes, count, accents, root, `${vp.w}x${vp.h}`);

  useLayoutEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Next keeps routes alive in <Activity>: when this page is hidden the zoom must end, and when it returns, put the reader back at the scene they left.
  useLayoutEffect(() => {
    // Next scrolls a page to the top after it commits, which would undo this, so put the reader back again over the next frames.
    const y = overviewReturn.y;
    let raf = 0;
    if (y !== null) {
      window.scrollTo(0, y);
      let frames = 0;
      // The target is cleared only once the last frame has run, so a development double-run of this effect still restores it.
      const again = () => {
        window.scrollTo(0, y);
        if (++frames < 4) raf = requestAnimationFrame(again);
        else overviewReturn.y = null;
      };
      raf = requestAnimationFrame(again);
    }
    return () => {
      cancelAnimationFrame(raf);
      setFlight(null);
    };
  }, []);

  // Arriving from a tile: the project's colour was filling the screen; let it lift away.
  useLayoutEffect(() => {
    if (transit.dir === "in" && !reduced) setCover({ mode: "fade-out" });
    else if (transit.dir === "in") transit.dir = null;
    return () => setCover(null);
  }, [reduced]);

  // Smooth scrolling is part of the cinematic layer, so it stays off under reduced motion.
  useEffect(() => {
    if (reduced) return;
    const instance = new Lenis({ autoRaf: true, lerp: 0.09 });
    lenis.current = instance;
    return () => {
      instance.destroy();
      lenis.current = null;
    };
  }, [reduced]);

  const first = parts[0]?.layers[0];
  useEffect(() => {
    if (first) router.prefetch(`/p/${project.id}/l/${first.id}`);
  }, [router, project.id, first]);

  const scrollToEl = useCallback((el: HTMLElement, into = 0) => {
    const top = el.getBoundingClientRect().top + window.scrollY + into;
    if (lenis.current) lenis.current.scrollTo(top, { duration: 1.2 });
    else window.scrollTo(0, top);
  }, []);
  const scrollToEnd = useCallback((el: HTMLElement) => scrollToEl(el, el.offsetHeight - window.innerHeight), [scrollToEl]);

  const go = useCallback(
    (layer: { id: string }) => {
      overviewReturn.y = window.scrollY;
      arrival.layerId = layer.id;
      router.push(`/p/${project.id}/l/${layer.id}`);
    },
    [router, project.id],
  );

  const onOpen: OpenSection = useCallback(
    (layer, sheet, size) => {
      if (reduced) return go(layer);
      const r = sheet?.getBoundingClientRect();
      lenis.current?.stop();
      setFlight(
        r && size.W
          ? { layer, cx: r.left + r.width / 2, cy: r.top + r.height / 2, W: size.W, H: size.H, tilted: true }
          : { layer, cx: window.innerWidth - 150, cy: 26, W: 240, H: 36, tilted: false },
      );
    },
    [go, reduced],
  );

  // The wordmark goes back to the landing page: the screen takes the project's colour, then the tile takes it back.
  const goHome = () => {
    transit.projectId = project.id;
    transit.dir = "out";
    if (reduced) return router.push("/");
    lenis.current?.stop();
    setCover({ mode: "fade-in", next: "/" });
  };

  const continueLayer = resume ? parts.flatMap((p) => p.layers).find((l) => l.id === resume.layerId) : undefined;
  const continueText = progress.saved === 0 ? "Start with the first layer" : `Continue with ${resume?.title ?? ""}`;

  // What finished while you were away: real work (the Librarian's sources) when there is some. Until every agent reports real tasks
  // (Phase 7), the rest is a mock built from this course's layers.
  const away: AwayItem[] = useMemo(() => {
    if (unseen.length) {
      // one line per kind of work: the latest run says what is there now, however many runs finished
      const latest = new Map(unseen.map((t) => [`${t.agent}:${t.kind}`, t]));
      return [...latest.values()].map((t) => ({ id: t.id, agent: t.agent, text: t.result ?? t.summary, onOpen: () => router.push(`/p/${project.id}/talk?tab=sources`) }));
    }
    const ls = parts.flatMap((p) => p.layers);
    return [
      ls[0] && { id: "w1", agent: "explainer" as const, text: `Wrote the Explained tab of ${ls[0].title}`, layer: ls[0] },
      ls[1] && { id: "w2", agent: "librarian" as const, text: `Picked the Source quotes for ${ls[1].title}`, layer: ls[1] },
      ls[2] && { id: "w3", agent: "connector" as const, text: `Linked ${ls[2].title} to the layer before it`, layer: ls[2] },
    ]
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, agent: x.agent, text: x.text, onOpen: () => go(x.layer) }));
  }, [parts, go, unseen, router, project.id]);

  const ticks = [...parts.map((p) => ({ id: p.id, label: p.name })), { id: "talk", label: "Let’s talk!" }, { id: "note", label: "Note to Self" }];

  return (
    <div className="ov" ref={root} style={{ ["--unit" as string]: rgbCss(accents[0]), ["--unit-now" as string]: rgbCss(accents[0]) }}>
      <Backdrop seed={title} accents={accents} motifs={motifs} pos={pos} icons={icons} reduced={reduced} />
      <header className="ov-bar-top">
        <button type="button" className="ov-wordmark" onClick={goHome} aria-label="Margin, back to your projects">
          Margin.
        </button>
        <span className="ov-bar-course">
          {project.courseCode && !title.startsWith(project.courseCode) ? `${project.courseCode}, ` : ""}
          {title}
        </span>
        {continueLayer && (
          <button type="button" className="ov-continue" onClick={() => onOpen(continueLayer, null, { W: 0, H: 0 })}>
            {continueText}
          </button>
        )}
      </header>

      {!reduced && <Rail vp={vp} scenes={scenes} ticks={ticks} onJump={(i) => scenes.current[i] && scrollToEl(scenes.current[i]!)} />}

      <main className="ov-main">
        <Intro reduced={reduced} title={title} accent={accents[0]} mode={agentMode} parts={parts} progress={progress} />
        {parts.map((p, i) => (
          // display: contents hands each scene its own accent without touching the scene itself.
          <div key={p.id} className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[i]) }}>
            {reduced ? (
              <FlatScene unit={p} onOpen={onOpen} sceneRef={(el) => void (scenes.current[i] = el)} />
            ) : (
              <Scene unit={p} vp={vp} flyingId={flight?.layer.id ?? null} onOpen={onOpen} scrollToEnd={scrollToEnd} sceneRef={(el) => void (scenes.current[i] = el)} />
            )}
          </div>
        ))}
        <div className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[parts.length]) }}>
          <TalkScene projectId={project.id} summary={talk} busy={running.length > 0 || agentMode === "busy"} reduced={reduced} sceneRef={(el) => void (scenes.current[parts.length] = el)} />
        </div>
        <section className="ov-note" ref={(el) => void (scenes.current[parts.length + 1] = el)} aria-labelledby="ov-note-h" style={{ ["--unit" as string]: rgbCss(accents[parts.length + 1]) }}>
          <h2 id="ov-note-h" className="ov-title">
            That is the whole course
          </h2>
          <p>{progressLabel(progress)}. Your own writing collects in Note to Self as you send it from each review.</p>
          <div className="ov-ends">
            <button type="button" className="ov-end ov-end-note" onClick={() => router.push(`/p/${project.id}/notes`)}>
              <NotebookArt />
              <span className="ov-end-body">
                <span className="ov-end-kicker">Your study guide</span>
                <span className="ov-end-title">Note to Self</span>
                <span className="ov-end-line">
                  {noted}/{progress.total} layers saved
                </span>
                <span className="ov-bar" aria-hidden="true">
                  {parts.flatMap((p) => p.layers).map((l) => (
                    <i key={l.id} className="ov-cell static" data-status={CSS_STATUS[bucketOf(l.state)]} />
                  ))}
                </span>
                <span className="ov-end-go">Open Note to Self</span>
              </span>
            </button>
            {continueLayer && (
              <div className="ov-end ov-end-next">
                <span className="ov-end-body">
                  <span className="ov-end-kicker">{progress.saved === 0 ? "Where to begin" : "Next layer"}</span>
                  <span className="ov-end-title">{continueLayer.title}</span>
                  <span className="ov-end-q">{continueLayer.focus}</span>
                </span>
                <button type="button" className="ov-end-primary" onClick={() => onOpen(continueLayer, null, { W: 0, H: 0 })}>
                  {continueText}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      <div className="ov-corner">
        <WhileAway items={away} onDismiss={unseen.length ? () => void dismiss() : undefined} />
      </div>
      <DevToggle />

      {cover && (
        <Curtain
          mode={cover.mode}
          rect={null}
          accent={accents[0]}
          onDone={() => {
            if (cover.next) router.push(cover.next);
            else {
              transit.dir = null;
              setCover(null);
            }
          }}
        />
      )}

      {flight && <Zoom flight={flight} vp={vp} onDone={() => go(flight.layer)} />}
    </div>
  );
}

/** The Note to Self tile: bound sheets with a plum ribbon, and the Librarian who files them. */
function NotebookArt() {
  return (
    <span className="ov-end-art" aria-hidden="true">
      <svg viewBox="0 0 170 120" width="170" height="120">
        <g transform="rotate(-7 92 66)">
          <rect x="44" y="26" width="98" height="72" rx="4" className="nb-sheet nb-back" />
        </g>
        <g transform="rotate(4 92 62)">
          <rect x="42" y="22" width="98" height="72" rx="4" className="nb-sheet nb-mid" />
        </g>
        <rect x="40" y="18" width="98" height="74" rx="4" className="nb-sheet" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={54 + i * 14} cy="18" r="3.2" className="nb-ring" />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="52" y={34 + i * 10} width={i === 4 ? 44 : 74} height="1.6" rx="0.8" className="nb-line" />
        ))}
        <path d="M120 18v34l6-5 6 5V18z" className="nb-ribbon" />
      </svg>
      <svg viewBox="0 0 40 46" width="44" height="51" className="ov-end-librarian" style={{ ["--c" as string]: "var(--agent-librarian)" }}>
        <Body id="librarian" />
      </svg>
    </span>
  );
}

/** The opening scene: the course's name and where you stand in it. */
function Intro({ reduced, title, accent, mode, parts, progress }: { reduced: boolean; title: string; accent: RGB; mode: AgentMode; parts: ScenePart[]; progress: ProgressCounts }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(p, [0, 0.8], [1, 1.5]);
  const opacity = useTransform(p, [0.25, 0.75], [1, 0]);
  const words = title.split(" ");
  const layers = parts.flatMap((x) => x.layers);
  return (
    <section className="ov-intro" ref={ref} aria-labelledby="ov-course">
      <motion.div className="ov-intro-in" style={reduced ? undefined : { scale, opacity }}>
        <div className="ov-hall">
          <Hall mode={mode} accent={accent} focus={[0.7, 0.4]} reduced={reduced} caption="Back at the table. Their work is waiting." />
        </div>
        <h1 id="ov-course" className="ov-course">
          {words.map((w, i) => (
            <Fragment key={i}>
              <span className="ov-w" style={{ animationDelay: `${100 + i * 110}ms` }}>
                {w}
              </span>{" "}
            </Fragment>
          ))}
        </h1>
        <div className="ov-intro-stat">
          <div className="ov-bar wide" role="img" aria-label={progressLabel(progress)}>
            {layers.map((l) => (
              <i key={l.id} className="ov-cell static" data-status={CSS_STATUS[bucketOf(l.state)]} title={`${l.title}: ${l.state === "saved" ? "saved" : "not saved"}`} />
            ))}
          </div>
          <p>
            {progressLabel(progress)}, in course order. {parts.length} Parts. Scroll to walk through them.
          </p>
        </div>
      </motion.div>
    </section>
  );
}

/** Slim progress rail: one tick per scene, filled to where you are. */
function Rail({ vp, scenes, ticks, onJump }: { vp: Viewport; scenes: React.RefObject<(HTMLElement | null)[]>; ticks: { id: string; label: string }[]; onJump: (i: number) => void }) {
  const { scrollY } = useScroll();
  const [tops, setTops] = useState<number[]>([]);
  const [active, setActive] = useState(-1);
  const n = ticks.length;

  // After commit, so the scenes' refs (later siblings) are attached.
  useEffect(() => {
    setTops(scenes.current.slice(0, n).map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0)));
  }, [vp, scenes, n]);

  const fill = useMotionValue(0);
  useMotionValueEvent(scrollY, "change", (y) => {
    if (tops.length < n) return;
    let i = -1;
    for (let k = 0; k < n; k++) if (y >= tops[k] - vp.h * 0.4) i = k;
    setActive(i);
    if (i < 0) return fill.set(0);
    const next = tops[i + 1] ?? tops[i] + (scenes.current[i]?.offsetHeight ?? vp.h);
    const within = Math.min(1, Math.max(0, (y - tops[i]) / (next - tops[i])));
    fill.set((i + within) / (n - 1 || 1));
  });
  const scaleY = useTransform(fill, [0, 1], [0, 1]);

  return (
    <nav className="ov-rail" aria-label="Parts">
      <span className="ov-rail-track" />
      <motion.span className="ov-rail-fill" style={{ scaleY }} />
      {ticks.map((t, i) => (
        <button key={t.id} type="button" className="ov-tick" data-active={i === active ? "" : undefined} aria-current={i === active ? "step" : undefined} style={{ top: `${(i / (n - 1 || 1)) * 100}%` }} onClick={() => onJump(i)}>
          <i />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The shared-element zoom: a sheet lifts out of the diagram, lies flat and grows until it is exactly the workspace's reading pane. */
function Zoom({ flight, vp, onDone }: { flight: Flight; vp: Viewport; onDone: () => void }) {
  const R = paperRect(vp.w, vp.h);
  const t = useMotionValue(0);
  const dx = flight.cx - (R.x + R.w / 2);
  const dy = flight.cy - (R.y + R.h / 2);
  const sx = flight.W / R.w;
  const sy = flight.H / R.h;
  const rx = flight.tilted ? ROT_X : 0;
  const rz = flight.tilted ? ROT_Z : 0;
  const transform = useTransform(t, (v) => {
    const k = 1 - v;
    return `translate(${dx * k}px, ${dy * k}px) rotateX(${rx * k}deg) rotateZ(${rz * k}deg) scale(${sx + (1 - sx) * v}, ${sy + (1 - sy) * v})`;
  });
  const desk = useTransform(t, [0, 0.55], [0, 1]);
  const print = useTransform(t, [0, 0.22], [1, 0]);
  const shadow = useTransform(t, [0, 1], [0.15, 1]);

  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const controls = animate(t, 1, { type: "spring", duration: 0.95, bounce: 0, onComplete: () => done.current() });
    return () => controls.stop();
  }, [t]);

  return (
    <div className="ov-zoom" aria-hidden="true">
      <motion.div className="ov-zoom-desk" style={{ opacity: desk }} />
      <motion.div className="ov-zoom-sheet" style={{ left: R.x, top: R.y, width: R.w, height: R.h, transform }}>
        <motion.div className="ov-zoom-shadow" style={{ opacity: shadow }} />
        {flight.tilted && (
          <motion.div className="ov-sheet ov-zoom-print" style={{ width: flight.W, height: flight.H, scaleX: 1 / sx, scaleY: 1 / sy, opacity: print }}>
            <SheetPrint title={flight.layer.title} state={flight.layer.state} />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
