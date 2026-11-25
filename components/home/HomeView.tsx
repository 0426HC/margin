"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability -- motion code: it measures the window after mount and drives Motion values imperatively */

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
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { LockControls } from "@/components/lockin/LockControls";
import { useLockIn } from "@/lib/lockin/store";
import { progressLabel } from "@/lib/layers/progress";
import type { ProjectCard } from "@/lib/layers/types";
import { openHref } from "@/lib/overview/tabs";

const CELL = { saved: "solid", open: "new" } as const;
const SETTLE = [0.23, 1, 0.32, 1] as const;

const INK_WORDS =
  "Your courses, one layer at a time. Read the explanation, check it against your own files, then write it back in your own words until it is right.".split(" ");

function partOfDay(h: number) {
  return h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

type Cover = { mode: CurtainMode; rect: Rect | null; accent: RGB; next?: string };

export function HomeView({ projects, showDemoOffer }: { projects: ProjectCard[]; showDemoOffer: boolean }) {
  const reduced = useReducedSafe();
  const router = useRouter();
  const lenis = useRef<Lenis | null>(null);
  const projectsRef = useRef<HTMLElement>(null);
  const tiles = useRef<Record<string, HTMLElement | null>>({});
  const [cover, setCover] = useState<Cover | null>(null);
  const [greeting, setGreeting] = useState("");
  const [deleting, setDeleting] = useState<ProjectCard | null>(null);
  const { mode } = useAgents();
  // Lock in: the same page in Graphite, without the backdrop, the agents' table or any motion.
  const locked = useLockIn();

  const accents = useMemo(() => (projects.length ? projects : [{ name: "Margin" }]).map((p) => unitAccents(p.name, 1)[0]), [projects]);
  const motifs = useMemo(() => (projects.length ? projects : [{ name: "Margin" }]).map((p) => unitMotifs(p.name, 1)[0]), [projects]);
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
  }, [reduced, accents, pos, projects]);

  const open = (p: ProjectCard, i: number) => {
    const el = tiles.current[p.id];
    transit.projectId = p.id;
    transit.dir = "in";
    if (reduced || !el || !p.ready) {
      router.push(openHref(p.id, p.href));
      return;
    }
    lenis.current?.stop();
    const r = el.getBoundingClientRect();
    transit.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    setCover({ mode: "expand", rect: transit.rect, accent: accents[i], next: openHref(p.id, p.href) });
  };

  const hover = (i: number | null) => {
    if (reduced || i === null) return;
    animate(pos, i, { duration: 1.4, ease: SETTLE });
  };

  const done = projects.reduce((n, p) => n + p.progress.saved, 0);

  return (
    <div className="ov ho">
      {!locked && <Backdrop seed="margin:home" accents={accents} motifs={motifs} pos={pos} reduced={reduced} />}
      <header className="ho-bar">
        <LockControls />
      </header>
      <main className="ho-main">
        {/* in lock in too: the same words in the same place, standing still (reduced counts lock in) */}
        <Hero reduced={reduced} greeting={greeting} done={done} hasProjects={projects.length > 0} />
        <section className="ho-projects" ref={projectsRef} aria-labelledby="ho-projects-h">
          <div className="ho-projects-head">
            <h2 id="ho-projects-h">Your projects</h2>
          </div>
          <div className="ho-grid">
            {projects.map((p, i) => (
              <Tile
                key={p.id}
                project={p}
                accent={accents[i]}
                index={i}
                mode={mode}
                reduced={reduced}
                locked={locked}
                tileRef={(el) => void (tiles.current[p.id] = el)}
                onOpen={() => open(p, i)}
                onHover={hover}
                onDelete={() => setDeleting(p)}
              />
            ))}
            {showDemoOffer && <DemoTile />}
            <NewTile />
          </div>
        </section>
      </main>
      {!locked && <DevToggle />}
      <DeleteProjectDialog
        project={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
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
function Hero({ reduced, greeting, done, hasProjects }: { reduced: boolean; greeting: string; done: number; hasProjects: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(p, [0, 0.8], [1, 1.45]);
  const opacity = useTransform(p, [0.25, 0.75], [1, 0]);
  return (
    <section className="ho-hero" ref={ref} aria-label="Margin">
      <motion.div className="ho-hero-in" style={reduced ? undefined : { scale, opacity }}>
        {/* a CSS entrance: it plays without waiting for scripts, and its resting state is the visible headline */}
        <h1 className="ho-word">Margin.</h1>
        <p className="ho-ink" aria-label={INK_WORDS.join(" ")}>
          {INK_WORDS.map((w, i) => (
            <span key={i} className="ho-ink-w" aria-hidden="true" style={{ animationDelay: `${reduced ? 0 : 900 + i * 55}ms` }}>
              {w}{" "}
            </span>
          ))}
        </p>
        <p className="ho-greet" style={{ animationDelay: reduced ? "0ms" : `${900 + INK_WORDS.length * 55 + 250}ms` }}>
          {greeting} {hasProjects ? `${done} ${done === 1 ? "layer is" : "layers are"} finished across your courses.` : "Bring in a course folder to begin."}
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
  locked,
  tileRef,
  onOpen,
  onHover,
  onDelete,
}: {
  project: ProjectCard;
  accent: RGB;
  index: number;
  mode: "idle" | "busy" | "done";
  reduced: boolean;
  locked: boolean;
  tileRef: (el: HTMLElement | null) => void;
  onOpen: () => void;
  onHover: (i: number | null) => void;
  onDelete: () => void;
}) {
  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width - 0.5).toFixed(3)}`);
    e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height - 0.5).toFixed(3)}`);
  };
  return (
    <article
      className="ho-tile"
      data-project-id={p.id}
      ref={tileRef}
      style={{ ["--unit" as string]: rgbCss(accent), ["--wash" as string]: rgbCss(accent, 0.3) }}
      onPointerMove={move}
      onPointerEnter={() => onHover(index)}
    >
      {!locked && (
        <div className="ho-hall">
          <Hall mode={mode} accent={accent} focus={[0.55, 0.52]} reduced={reduced} />
        </div>
      )}
      <div className="ho-tile-body">
        <p className="ho-code">
          {p.courseCode}
          {p.isDemo && <span className="ho-example">Demo, public-domain text</span>}
        </p>
        <h3>
          <button type="button" className="ho-open" onClick={onOpen}>
            {p.name}
          </button>
        </h3>
        {p.draft ? (
          <>
            <p className="ho-draft">Draft · not finished</p>
            <div className="ho-draft-actions">
              <button type="button" className="ho-draft-btn" onClick={onOpen}>
                Continue setup
              </button>
              <button type="button" className="ho-draft-btn quiet" onClick={onDelete}>
                Discard
              </button>
            </div>
          </>
        ) : (
          <>
            {p.ready ? (
              <div className="ho-week">
                <p className="ho-week-line">
                  {p.weekCount ? `Week ${p.currentWeek} of ${p.weekCount}` : `Week ${p.currentWeek}`} · {progressLabel(p.progress)}
                </p>
                <span className="ov-bar" role="img" aria-label={`${p.progress.saved} of ${p.progress.total} layers saved`}>
                  {([["saved", p.progress.saved], ["open", p.progress.notSaved]] as const)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <i key={k} className="ov-cell static" data-status={CELL[k]} style={{ flex: n }} />
                    ))}
                </span>
              </div>
            ) : (
              <p className="ho-resume">Not finished setting up yet.</p>
            )}
            <p className="ho-resume" title={resumeLine(p)}>
              {resumeLine(p)}
            </p>
          </>
        )}
      </div>
      {/* after the project's own button, so that button stays first in the page and in the Tab order */}
      <MoreMenu className="ho-more" label={`More actions for ${p.name}`} items={[{ label: p.draft ? "Discard draft" : "Delete project", onSelect: onDelete }]} />
    </article>
  );
}

/** One line inside the card: where to continue, or the next setup step. */
function resumeLine(p: ProjectCard) {
  if (!p.ready) return `Next: ${p.resume}`;
  const finished = p.progress.total > 0 && p.progress.saved === p.progress.total;
  return finished ? p.resume : `Continue: ${p.resume}`;
}

function DemoTile() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/demo", { method: "POST" }).catch(() => null);
    if (!r?.ok) {
      setBusy(false);
      setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Margin couldn't open the demo. Check that the app is still running, then try again.");
      return;
    }
    const { id } = (await r.json()) as { id: string };
    router.push(`/p/${id}`);
  }
  return (
    <article className="ho-tile ho-new">
      <svg className="ho-new-mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M8 6h18l6 6v22H8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M13 17h14M13 22h14M13 27h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div>
        <h3>
          <button type="button" className="ho-open" onClick={start} disabled={busy}>
            {busy ? "Opening the demo" : "Open the demo course"}
          </button>
        </h3>
        <p>A few Federalist Papers, already split into layers, so you can try Margin without your own files. The text is public domain.</p>
        {error && <p role="alert" className="ho-error">{error}</p>}
      </div>
    </article>
  );
}

function NewTile() {
  const router = useRouter();
  return (
    <article className="ho-tile ho-new">
      <svg className="ho-new-mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M6 12a3 3 0 0 1 3-3h7l3 4h12a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M20 19v8M16 23h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div>
        <h3>
          <button type="button" className="ho-open" onClick={() => router.push("/new")}>New project</button>
        </h3>
        <p>Drop in a course folder. Margin works out the weeks and the layers of each, and shows you the plan to check.</p>
      </div>
    </article>
  );
}
