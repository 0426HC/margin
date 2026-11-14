"use client";

import Lenis from "lenis";
import { animate, motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTIVE_ID, course, units, type SectionMeta } from "../data";
import { arrival, overviewReturn, paperRect } from "../panes";
import { DevToggle, WhileAway } from "@/components/cinematic/Agents";
import { Hall } from "@/components/cinematic/Hall";
import { useAgents } from "@/components/cinematic/agentState";
import { Backdrop } from "@/components/cinematic/Backdrop";
import { Curtain, type CurtainMode } from "@/components/cinematic/Curtain";
import { unitAccents, unitIcons, unitMotifs, rgbCss, type RGB } from "@/components/cinematic/theme";
import type { AgentMode } from "@/components/cinematic/agentState";
import { transit } from "@/components/cinematic/transit";
import { useUnitPos } from "@/components/cinematic/useUnitPos";
import { byId } from "../home/projects";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { ROT_X, ROT_Z, type Viewport } from "@/components/cinematic/geometry";
import { FlatScene, Scene, SheetPrint, tally, type OpenSection } from "./Scene";

const WORKSPACE = "/design-lab";
const HOME = "/design-lab/home";
const allSections = units.flatMap((u) => u.sections);
const dueCount = allSections.filter((s) => s.due).length;

type Flight = { section: SectionMeta; cx: number; cy: number; W: number; H: number; tilted: boolean };

export function OverviewView({ projectId }: { projectId?: string }) {
  const reduced = useReducedSafe();
  const project = byId(projectId);
  const router = useRouter();
  const [vp, setVp] = useState<Viewport>({ w: 1440, h: 900 });
  const [flight, setFlight] = useState<Flight | null>(null);
  const lenis = useRef<Lenis | null>(null);
  const scenes = useRef<(HTMLElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<{ mode: CurtainMode; next?: string } | null>(null);
  const { mode: agentMode } = useAgents();

  // Every look is seeded from the project's title: the same course always opens the same way.
  const accents = useMemo(() => unitAccents(project.title, units.length), [project.title]);
  const motifs = useMemo(() => unitMotifs(project.title, units.length), [project.title]);
  const icons = useMemo(
    () => units.map((u) => unitIcons(`${u.name} ${u.why} ${u.sections.map((x) => x.focus).join(" ")}`)),
    [],
  );
  const pos = useUnitPos(scenes, units.length, accents, root, `${vp.w}x${vp.h}`);

  useLayoutEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Next keeps routes alive in <Activity>: when this page is hidden, the zoom must end, and when
  // it returns, put the reader back at the scene they left.
  useLayoutEffect(() => {
    if (overviewReturn.y !== null) {
      window.scrollTo(0, overviewReturn.y);
      overviewReturn.y = null;
    }
    return () => setFlight(null);
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

  useEffect(() => {
    router.prefetch(WORKSPACE);
  }, [router]);

  const scrollToEl = useCallback(
    (el: HTMLElement, into = 0) => {
      const top = el.getBoundingClientRect().top + window.scrollY + into;
      if (lenis.current) lenis.current.scrollTo(top, { duration: 1.2 });
      else window.scrollTo(0, top);
    },
    [],
  );

  const scrollToEnd = useCallback(
    (el: HTMLElement) => scrollToEl(el, el.offsetHeight - window.innerHeight),
    [scrollToEl],
  );

  const go = useCallback(
    (section: SectionMeta) => {
      overviewReturn.y = window.scrollY;
      arrival.sectionId = section.id;
      router.push(`${WORKSPACE}?section=${section.id}`);
    },
    [router],
  );

  const onOpen: OpenSection = useCallback(
    (section, sheet, size) => {
      if (reduced) {
        go(section);
        return;
      }
      const r = sheet?.getBoundingClientRect();
      lenis.current?.stop();
      setFlight(
        r && size.W
          ? { section, cx: r.left + r.width / 2, cy: r.top + r.height / 2, W: size.W, H: size.H, tilted: true }
          : { section, cx: window.innerWidth - 150, cy: 26, W: 240, H: 36, tilted: false },
      );
    },
    [go, reduced],
  );

  // The wordmark goes back to the landing page: the screen takes the project's colour, then the tile takes it back.
  const goHome = () => {
    transit.projectId = project.id;
    transit.dir = "out";
    if (reduced) {
      router.push(HOME);
      return;
    }
    lenis.current?.stop();
    setCover({ mode: "fade-in", next: HOME });
  };

  const continueSection = allSections.find((s) => s.id === ACTIVE_ID)!;

  return (
    <div className="ov" ref={root} style={{ ["--unit" as string]: rgbCss(accents[0]), ["--unit-now" as string]: rgbCss(accents[0]) }}>
      <Backdrop seed={project.title} accents={accents} motifs={motifs} pos={pos} icons={icons} reduced={reduced} />
      <header className="ov-bar-top">
        <button type="button" className="ov-wordmark" onClick={goHome} aria-label="Margin, back to your projects">
          Margin.
        </button>
        <span className="ov-bar-course">
          {project.code}, {project.title}
        </span>
        <button type="button" className="ov-continue" onClick={() => onOpen(continueSection, null, { W: 0, H: 0 })}>
          Continue reading No. 10, part 1
        </button>
      </header>

      {!reduced && <Rail vp={vp} scenes={scenes} onJump={(i) => scenes.current[i] && scrollToEl(scenes.current[i]!)} />}

      <main className="ov-main">
        <Intro reduced={reduced} title={project.title} accent={accents[0]} mode={agentMode} />
        {units.map((u, i) => (
          // display: contents hands each scene its own accent without touching the scene itself.
          <div key={u.id} className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[i]) }}>
            {reduced ? (
              <FlatScene unit={u} onOpen={onOpen} sceneRef={(el) => void (scenes.current[i] = el)} />
            ) : (
              <Scene
                unit={u}
                vp={vp}
                flyingId={flight?.section.id ?? null}
                onOpen={onOpen}
                scrollToEnd={scrollToEnd}
                sceneRef={(el) => void (scenes.current[i] = el)}
              />
            )}
          </div>
        ))}
        <section className="ov-outro">
          <p>That is the whole course. {dueCount} sections are due for review today.</p>
          <button type="button" className="ov-outro-btn" onClick={() => onOpen(continueSection, null, { W: 0, H: 0 })}>
            Continue reading No. 10, part 1
          </button>
        </section>
      </main>

      <div className="ov-corner">
        <WhileAway />
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

      {flight && <Zoom flight={flight} vp={vp} onDone={() => go(flight.section)} />}
    </div>
  );
}

/** The opening scene: the course's name and where you stand in it. */
function Intro({ reduced, title, accent, mode }: { reduced: boolean; title: string; accent: RGB; mode: AgentMode }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(p, [0, 0.8], [1, 1.5]);
  const opacity = useTransform(p, [0.25, 0.75], [1, 0]);
  const solid = tally(allSections)[0].count;
  const words = title.split(" ");
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
          <div className="ov-bar wide" role="img" aria-label={`${solid} of ${allSections.length} sections solid`}>
            {allSections.map((s) => (
              <i key={s.id} className="ov-cell static" data-status={s.status} title={`${s.title}: ${s.status}`} />
            ))}
          </div>
          <p>
            {solid} of {allSections.length} sections solid, in reading order. {units.length - 1} weeks. Scroll to walk through them.
          </p>
        </div>
      </motion.div>
    </section>
  );
}

/** Slim progress rail: one tick per unit, filled to where you are. */
function Rail({
  vp,
  scenes,
  onJump,
}: {
  vp: Viewport;
  scenes: React.RefObject<(HTMLElement | null)[]>;
  onJump: (i: number) => void;
}) {
  const { scrollY } = useScroll();
  const [tops, setTops] = useState<number[]>([]);
  const [active, setActive] = useState(-1);
  const n = units.length;

  // After commit, so the scenes' refs (later siblings) are attached.
  useEffect(() => {
    setTops(scenes.current.map((el) => (el ? el.getBoundingClientRect().top + window.scrollY : 0)));
  }, [vp, scenes]);

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
    <nav className="ov-rail" aria-label="Units">
      <span className="ov-rail-track" />
      <motion.span className="ov-rail-fill" style={{ scaleY }} />
      {units.map((u, i) => (
        <button
          key={u.id}
          type="button"
          className="ov-tick"
          data-active={i === active ? "" : undefined}
          aria-current={i === active ? "step" : undefined}
          style={{ top: `${(i / (n - 1)) * 100}%` }}
          onClick={() => onJump(i)}
        >
          <i />
          <span>{u.label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * The shared-element zoom: a sheet lifts out of the diagram, lies flat and grows until it is
 * exactly the workspace's reading pane. Everything else is the walnut desk fading up beneath it.
 */
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
    const controls = animate(t, 1, {
      type: "spring",
      duration: 0.95,
      bounce: 0,
      onComplete: () => done.current(),
    });
    return () => controls.stop();
  }, [t]);

  return (
    <div className="ov-zoom" aria-hidden="true">
      <motion.div className="ov-zoom-desk" style={{ opacity: desk }} />
      <motion.div className="ov-zoom-sheet" style={{ left: R.x, top: R.y, width: R.w, height: R.h, transform }}>
        <motion.div className="ov-zoom-shadow" style={{ opacity: shadow }} />
        {flight.tilted && (
          <motion.div className="ov-sheet ov-zoom-print" style={{ width: flight.W, height: flight.H, scaleX: 1 / sx, scaleY: 1 / sy, opacity: print }}>
            <SheetPrint title={flight.section.title} status={flight.section.status} />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

