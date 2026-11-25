"use client";

/* eslint-disable react-hooks/set-state-in-effect -- motion code: it measures the window after mount and drives Motion values imperatively */

import type { WritingStatus } from "@/lib/layers/background";
import { BackgroundProgress } from "./BackgroundProgress";
import { animate, motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DevToggle, WhileAway, type AwayItem } from "@/components/cinematic/Agents";
import { Backdrop } from "@/components/cinematic/Backdrop";
import { Curtain, type CurtainMode } from "@/components/cinematic/Curtain";
import { Hall } from "@/components/cinematic/Hall";
import { ROT_X, ROT_Z, type Viewport } from "@/components/cinematic/geometry";
import { useAgents, type AgentMode } from "@/components/cinematic/agentState";
import { useAgentTasks } from "@/components/cinematic/useAgentTasks";
import { rgbCss, unitAccents, unitIcons, unitMotifs, type RGB } from "@/components/cinematic/theme";
import { transit } from "@/components/cinematic/transit";
import { useHydrated } from "@/components/cinematic/useHydrated";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { useScrollTimelines } from "@/components/cinematic/useScrollTimelines";
import { useUnitPos } from "@/components/cinematic/useUnitPos";
import { arrival, overviewReturn, paperRect } from "@/lib/layout/panes";
import { noteOpening, rememberCourse } from "@/lib/layers/frame-peek";
import { progressLabel, type ProgressCounts } from "@/lib/layers/progress";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { UpdatesDialog, type UpdatesMode } from "@/components/updates/UpdatesDialog";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WeekCountField } from "@/components/setup/WeekCountField";
import { courseTitle } from "@/lib/projects/title";
import { LockControls } from "@/components/lockin/LockControls";
import { PlainOverview } from "@/components/lockin/PlainOverview";
import { useLockIn } from "@/lib/lockin/store";
import { updateLines } from "@/lib/lockin/held";
import type { WeekSummary } from "@/lib/weeks/notes";
import type { ExamListItem, ExamView } from "@/lib/exam/service";
import type { StructureModel } from "@/lib/layers/types";
import type { NoteGuide } from "@/lib/layers/note-to-self";
import { TalkSection } from "@/components/talk/TalkSection";
import { WeeksSection } from "@/components/weeks/WeeksSection";
import { ExamSection } from "@/components/exam/ExamSection";
import { NoteToSelf } from "@/components/layers/NoteToSelf";
import type { ExamSummary } from "@/lib/exam/types";
import { NotebookArt } from "@/components/art/NotebookArt";
import { DEFAULT_TAB, TABS, noteShownTab, parseTab, rememberTab, rememberedTab, tabHref, type CourseTab } from "@/lib/overview/tabs";
import { shortDate } from "@/lib/lockin/plain";
import { AgentPanel, useAgentRequests } from "./AgentPanel";
import { ExamScene } from "./ExamScene";
import { TalkScene, type TalkSummary } from "./TalkScene";
import { WeeksScene } from "./WeeksScene";
import { StoryScene } from "./StoryScene";
import { FlatScene, Scene, SheetPrint, bucketOf, type OpenSection, type SceneLayer, type SceneWeek } from "./Scene";

export interface OverviewData {
  project: { id: string; name: string; courseCode: string | null; isDemo: boolean };
  /** How far background work has got: "Margin has read 4 of 12 weeks", "12 of 18 layers ready". */
  writing: WritingStatus;
  /** Every week of the course, in order; weeks whose material hasn't been added yet have no layers. */
  weekScenes: SceneWeek[];
  progress: ProgressCounts;
  /** The first layer not yet done. */
  resume: { layerId: string; title: string } | null;
  /** How many layers have a saved version in Note to Self. */
  noted: number;
  /** The Let's talk! section: what is in it. */
  talk: TalkSummary;
  /** Every week of the course, for the Lecture notes scene. */
  weeks: WeekSummary[];
  /** The exams of the project (Midterm, Final), for the exam room scene. */
  exams: ExamListItem[];
  /** The week the student is in, for the Lecture notes scene. */
  currentWeek: number;
  /** What the first exam's sheet says (the callouts beside the exam desk); null when this course has no sheet read yet. */
  examSheet: ExamSummary | null;
  /** For lock in, where each tab shows its real page: the course's structure, the first exam, and Note to Self. */
  model: StructureModel;
  examView: ExamView | null;
  noteGuide: NoteGuide;
}

type Flight = { layer: SceneLayer; cx: number; cy: number; W: number; H: number; tilted: boolean };
const SCENES_AFTER_WEEKS = 4; // Let's talk!, Lecture notes, the exam room, then the Note to Self scene: each in its own tab now
/** Which unit look (accent) each tab after Layers keeps: they follow the weeks, in tab order. */
const TAB_UNIT: Record<Exclude<CourseTab, "layers">, number> = { talk: 0, "lecture-notes": 1, exam: 2, "note-to-self": 3 };
const CSS_STATUS = { saved: "solid", open: "new" } as const;

export function OverviewView({ data }: { data: OverviewData }) {
  const scrollTimelines = useScrollTimelines();
  const { project, weekScenes: allWeeks, progress, resume, noted, talk, weeks, exams, currentWeek, examSheet, model, examView, noteGuide } = data;
  // Lock in, reduced motion, or a browser without scroll timelines (the scenes' motion is CSS on them): the plain page, nothing moving.
  const reduced = useReducedSafe() || !scrollTimelines;
  // Lock in: one plain screen instead of the scenes, and nothing drawn behind it.
  const locked = useLockIn();
  // Only weeks with layers get a scene; the weeks still to come are listed after them.
  const weekScenes = useMemo(() => allWeeks.filter((w) => w.layers.length > 0), [allWeeks]);
  const waiting = allWeeks.filter((w) => !w.layers.length);
  // The page as sent shows each week as plain, readable content; the scroll-driven teardown takes over only once scripts run.
  const hydrated = useHydrated();
  const router = useRouter();
  const [vp, setVp] = useState<Viewport>({ w: 1440, h: 900 });
  const [flight, setFlight] = useState<Flight | null>(null);
  const scenes = useRef<(HTMLElement | null)[]>([]);
  const [cover, setCover] = useState<{ mode: CurtainMode; next?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [updating, setUpdating] = useState<UpdatesMode | null>(null);
  const [agentTab, setAgentTab] = useState<"note" | "ready" | null>(null);
  const requests = useAgentRequests(project.id);
  const { mode: agentMode } = useAgents();
  const { running, unseen, dismiss } = useAgentTasks(project.id);
  const count = weekScenes.length + SCENES_AFTER_WEEKS;
  const title = project.name;

  // Every look is seeded from the project's title: the same course always opens the same way.
  const accents = useMemo(() => unitAccents(title, count), [title, count]);
  const motifs = useMemo(() => unitMotifs(title, count), [title, count]);
  const icons = useMemo(
    () => [...weekScenes.map((p) => unitIcons(`${p.name} ${p.why} ${p.layers.map((l) => `${l.title} ${l.focus}`).join(" ")}`)), unitIcons("let's talk chat sources notepad conversation"), unitIcons("lecture notes week lecture calendar"), unitIcons("exam room practice paper timer marks"), unitIcons("note to self study guide")],
    [weekScenes],
  );
  // The tab lives in the address (?tab=talk), so back, forward and refresh keep it. Switching writes it with pushState.
  const search = useSearchParams();
  const asked = parseTab(search.get("tab"));
  const tab: CourseTab = asked ?? DEFAULT_TAB;
  // true once a tab has been switched here: the new tab's scene then plays its entrance (on first load it is shown as sent)
  const [entered, setEntered] = useState(false);
  const layersY = useRef(0);
  const rail = useRef<HTMLElement>(null);
  const railEls = useRef<(HTMLElement | null)[]>([]);
  const fixedUnit = tab === "layers" ? null : weekScenes.length + TAB_UNIT[tab];
  const pos = useUnitPos(scenes, tab === "layers" ? weekScenes.length : count, accents, rail, `${vp.w}x${vp.h}:${hydrated}:${tab}`, fixedUnit);

  // A bare address opens the tab used last in this project; any other address is remembered as the last one.
  useLayoutEffect(() => {
    if (asked) return rememberTab(project.id, asked);
    const last = rememberedTab(project.id);
    if (last && last !== DEFAULT_TAB) window.history.replaceState(null, "", tabHref(project.id, last));
  }, [asked, project.id]);

  // the tab on show, so a section page opened from here can lead back to it (its back link and Esc)
  useEffect(() => noteShownTab(project.id, tab), [project.id, tab]);

  // Each tab starts at its top; Layers comes back to where it was left. Its place is kept while it is shown (by the time another tab has
  // rendered, the browser has already clamped the scroll to the shorter page), so the back button returns to it too. The place comes
  // from Motion's own reading of the scroll, made once a frame with its other reads: reading window.scrollY in a scroll listener here
  // made the browser restyle the page on every scroll event, after the weeks' scenes had changed it, which is what made a long course
  // stutter (docs/perf.md).
  const { scrollY: pageY } = useScroll();
  useLayoutEffect(() => {
    if (tab !== "layers") return;
    return pageY.on("change", (y) => void (layersY.current = y));
  }, [tab, pageY]);
  const shownTab = useRef(tab);
  useLayoutEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    const y = tab === "layers" ? layersY.current : 0;
    window.scrollTo(0, y);
  }, [tab]);

  // On a narrow screen the tabs scroll sideways: keep the open one in view (no animation, it follows the student's own action).
  // Only the strip itself scrolls, never the page (scrollIntoView would move every scrollable ancestor).
  useEffect(() => {
    const el = document.getElementById(`ov-tab-${tab}`);
    const strip = el?.parentElement;
    if (!el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
  }, [tab]);

  const selectTab = useCallback(
    (t: CourseTab) => {
      if (t === tab) return;
      setEntered(true);
      window.history.pushState(null, "", tabHref(project.id, t));
    },
    [tab, project.id],
  );
  const tabStatus: Partial<Record<CourseTab, string>> = {
    layers: `${progress.saved}/${progress.total}`,
    "lecture-notes": weeks.length ? `wk ${currentWeek}` : undefined,
    exam: examSheet?.date ? shortDate(examSheet.date).replace(/,?\s*\d{4}$/, "") : undefined,
  };

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

  // The header (top bar and tabs) never has a background: it floats over the page's backdrop. On the Layers tab the scrolling content
  // fades out just below it instead (a CSS mask on the content, see overview.css).
  const head = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Everything pinned or sized to the window (the weeks' stages, each tab's scene, the real pages in lock in) uses the space below the
  // header, whose height changes when the bar wraps on a narrow screen. 100 px is the header at laptop sizes, until it is measured.
  const [headH, setHeadH] = useState(100);
  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.current?.style.setProperty("--ov-head-h", `${h}px`);
      setHeadH(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the weeks' scenes are laid out in the space below the header
  const sceneVp = useMemo(() => ({ w: vp.w, h: Math.max(320, vp.h - headH) }), [vp, headH]);
  // The content's mask is drawn in window coordinates. A scroll-driven CSS animation moves it with the page (overview.css), so nothing runs
  // per frame; this only tells it where the content starts and how far the page scrolls, again whenever either changes. Browsers without
  // scroll-driven animations get the same result from a scroll listener.
  const syncMask = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    syncMask.current = () => {};
    if (tab !== "layers") return;
    const el = root.current?.querySelector<HTMLElement>(":scope > .ov-main, :scope > .lk-ov");
    if (!el) return;
    const timeline = CSS.supports("animation-timeline: scroll()");
    let top = 0;
    const measure = () => {
      top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      el.style.setProperty("--ov-top", `${top}px`);
      el.style.setProperty("--ov-range", `${Math.max(0, document.documentElement.scrollHeight - window.innerHeight)}px`);
      syncMask.current();
    };
    if (!timeline) syncMask.current = () => void (el.style.maskPosition = `0 ${Math.round(window.scrollY - top)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onScroll = () => syncMask.current();
    if (!timeline) window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      syncMask.current = () => {};
      el.style.maskPosition = "";
    };
  }, [tab, locked, hydrated, headH]);

  // Scrolling is the browser's own. Lenis (smooth scrolling) set the scroll position from script on every frame, so the page could only
  // move when the main thread was free and each frame forced a restyle of every scene; a course with many weeks, with Claude busy beside
  // it, stuttered (docs/scroll-progress.md). The browser scrolls on its own thread, and the scenes follow the same scroll position.

  const first = weekScenes[0]?.layers[0];
  useEffect(() => {
    if (first) router.prefetch(`/p/${project.id}/l/${first.id}`);
  }, [router, project.id, first]);

  const scrollToEl = useCallback((el: HTMLElement, into = 0) => {
    const top = el.getBoundingClientRect().top + window.scrollY + into;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);
  const scrollToEnd = useCallback((el: HTMLElement) => scrollToEl(el, el.offsetHeight - window.innerHeight), [scrollToEl]);

  const go = useCallback(
    (layer: { id: string }) => {
      const href = `/p/${project.id}/l/${layer.id}`;
      overviewReturn.y = window.scrollY;
      arrival.layerId = layer.id;
      noteOpening(href);
      router.push(href);
    },
    [router, project.id],
  );
  // a layer opened from here draws its frame at once from this course's structure
  useEffect(() => rememberCourse(model), [model]);

  const onOpen: OpenSection = useCallback(
    (layer, sheet, size) => {
      if (reduced) return go(layer);
      const r = sheet?.getBoundingClientRect();
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
    setCover({ mode: "fade-in", next: "/" });
  };

  const courseLine = courseTitle(title, project.courseCode);
  const continueLayer = resume ? weekScenes.flatMap((p) => p.layers).find((l) => l.id === resume.layerId) : undefined;
  const continueText = progress.saved === 0 ? "Start with the first layer" : `Continue with ${resume?.title ?? ""}`;

  // What finished while you were away: real work (the Librarian's sources) when there is some. Until every agent reports real tasks
  // (Phase 7), the rest is a mock built from this course's layers.
  const away: AwayItem[] = useMemo(() => {
    if (unseen.length) {
      // one line per kind of work: the latest run says what is there now, however many runs finished (each document is its own line)
      return updateLines(unseen).map((t) => ({ id: t.id, agent: t.agent, text: t.result ?? t.summary, onOpen: () => (t.kind === "make-document" ? setAgentTab("ready") : router.push(`/p/${project.id}/talk?tab=sources`)) }));
    }
    const ls = weekScenes.flatMap((p) => p.layers);
    return [
      ls[0] && { id: "w1", agent: "explainer" as const, text: `Wrote the Explained tab of ${ls[0].title}`, layer: ls[0] },
      ls[1] && { id: "w2", agent: "librarian" as const, text: `Picked the Source quotes for ${ls[1].title}`, layer: ls[1] },
      ls[2] && { id: "w3", agent: "connector" as const, text: `Linked ${ls[2].title} to the layer before it`, layer: ls[2] },
    ]
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, agent: x.agent, text: x.text, onOpen: () => go(x.layer) }));
  }, [weekScenes, go, unseen, router, project.id]);

  // The rail covers only what is inside the Layers tab: the opening, then one tick per week.
  const ticks = [{ id: "start", label: "Start" }, ...weekScenes.map((p) => ({ id: p.id, label: p.name.split(" · ")[0] }))]; // the rail is slim: "Week 3"; the scene says its topic

  return (
    <div className="ov ov-tabbed" data-tab={tab} ref={root} style={{ ["--unit" as string]: rgbCss(accents[fixedUnit ?? 0]) }}>
      {!locked && <Backdrop seed={title} accents={accents} motifs={motifs} pos={pos} icons={icons} reduced={reduced} sideIconsFrom={weekScenes.length} />}
      <div className="ov-head" ref={head}>
      <header className="ov-bar-top">
        <button type="button" className="ov-wordmark" onClick={goHome} aria-label="Margin, back to your projects">
          Margin.
        </button>
        <span className="ov-bar-course">{courseLine}</span>
        <BackgroundProgress projectId={project.id} initial={data.writing} />
        <span className="ov-actions">
          <button type="button" className="ov-ghost" onClick={() => setUpdating("folder")}>
            Update from folder
          </button>
          <button type="button" className="ov-ghost" onClick={() => setUpdating("files")}>
            Add files
          </button>
          {continueLayer && !locked && (
            <button type="button" className="ov-continue" onClick={() => onOpen(continueLayer, null, { W: 0, H: 0 })}>
              {continueText}
            </button>
          )}
          <LockControls />
        </span>
        <span className="ov-more-wrap">
          <MoreMenu
            className="ov-more"
            label={`More actions for ${title}`}
            items={[
              ...(project.isDemo
                ? []
                : [
                    { label: `This course has ${weeks.length || "?"} weeks`, onSelect: () => setWeeksOpen(true) },
                    { label: "Files, weeks and types", onSelect: () => router.push(`/p/${project.id}/files`) },
                  ]),
              { label: "Delete project", onSelect: () => setDeleting(true) },
            ]}
          />
        </span>
      </header>
      <CourseTabs projectId={project.id} tab={tab} status={tabStatus} onSelect={selectTab} />
      </div>
      <AgentPanel
        projectId={project.id}
        tab={agentTab}
        onTab={setAgentTab}
        onClose={() => setAgentTab(null)}
        data={requests.data}
        refresh={requests.refresh}
        suggestions={[
          weekScenes[0] ? `A one-page study guide for ${weekScenes[0].name}` : "A one-page study guide for the first week of the course",
          weekScenes[0]?.layers[1] ? `The key terms in “${weekScenes[0].layers[1].title}”, each with where it appears` : "The key terms of the course, each with where it appears",
          weekScenes[1]?.layers[0] ? `An essay plan checklist for: ${weekScenes[1].layers[0].focus}` : "An essay plan checklist for the main question of the course",
          weekScenes[0]?.layers[0] ? `Find every passage about ${weekScenes[0].layers[0].title.toLowerCase()}` : "Find every passage about the main idea of the course",
        ]}
      />
      <UpdatesDialog projectId={project.id} isDemo={project.isDemo} mode={updating} onClose={() => setUpdating(null)} />
      <ConfirmDialog open={weeksOpen} title="How many weeks does this course run?" confirmLabel="Done" onConfirm={() => setWeeksOpen(false)} onCancel={() => setWeeksOpen(false)}>
        <p>Lecture notes, the Weeks view and the week labels on layers all follow this number.</p>
        <WeekCountField projectId={project.id} weekCount={weeks.length || null} />
      </ConfirmDialog>
      <DeleteProjectDialog
        project={deleting ? { id: project.id, name: title, isDemo: project.isDemo } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          transit.dir = null; // no curtain: the project is gone, so there is no tile to return to
          router.push("/");
          router.refresh();
        }}
      />

      {tab === "layers" && !locked && !reduced && hydrated && <Rail railRef={rail} vp={vp} scenes={railEls} ticks={ticks} onJump={(i) => railEls.current[i] && scrollToEl(railEls.current[i]!)} />}

      {/* The page as sent carries both, and the CSS shows the one that fits <html data-lockin> (set before the first paint), so either
          mode is readable before scripts run. Once hydrated, only the one in use stays. */}
      {/* The page as sent carries both, and the CSS shows the one that fits <html data-lockin> (set before the first paint), so either
          mode is readable before scripts run. Once hydrated, only the one in use stays. */}
      {tab === "layers" && (locked || !hydrated) && (
        <PlainOverview projectId={project.id} title={title} weekScenes={allWeeks} resume={resume} />
      )}
      {/* Lock in: every other tab is the real page itself, with all its features, under this top bar and these tabs. */}
      {tab !== "layers" && (locked || !hydrated) && (
        <div className="ov-embed" id={`ov-panel-${tab}-real`} aria-labelledby={`ov-tab-${tab}`}>
          {tab === "talk" && <TalkSection key={project.id} model={model} initialTab="chat" embedded />}
          {tab === "lecture-notes" && <WeeksSection key={project.id} model={model} weeks={weeks} view={{ kind: "all", start: 1 }} embedded />}
          {tab === "exam" && <ExamSection key={`${project.id}:${examView?.id ?? "none"}`} model={model} exams={exams} view={examView} isDemo={project.isDemo} embedded />}
          {tab === "note-to-self" && <NoteToSelf guide={noteGuide} embedded />}
        </div>
      )}
      {!locked && (
        // keyed by tab: the new tab mounts fresh, fades in (opacity only) and its scene plays its entrance
        <main className="ov-main" key={tab} data-enter={entered ? "" : undefined} id={`ov-panel-${tab}`} aria-labelledby={`ov-tab-${tab}`}>
          {tab === "layers" && (
            <>
              <Intro reduced={reduced} title={title} accent={accents[0]} mode={agentMode} weekScenes={weekScenes} progress={progress} readyCount={requests.data?.ready.length ?? 0} onAgents={setAgentTab} sceneRef={(el) => void (railEls.current[0] = el)} />
              {weekScenes.map((p, i) => {
                const sceneRef = (el: HTMLElement | null) => {
                  scenes.current[i] = el;
                  railEls.current[i + 1] = el;
                };
                return (
                  // display: contents hands each scene its own accent without touching the scene itself.
                  <div key={p.id} className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[i]) }}>
                    {reduced || !hydrated ? (
                      <FlatScene unit={p} onOpen={onOpen} sceneRef={sceneRef} />
                    ) : (
                      <Scene unit={p} vp={sceneVp} topMin={36} flyingId={flight?.layer.id ?? null} onOpen={onOpen} scrollToEnd={scrollToEnd} sceneRef={sceneRef} />
                    )}
                  </div>
                );
              })}
              {waiting.length > 0 && (
                <section className="ov-later" aria-labelledby="ov-later-h">
                  <h2 id="ov-later-h">Still to come</h2>
                  <ul>
                    {waiting.map((w) => (
                      <li key={w.id}>
                        <span className="ov-later-name">{w.name}</span>
                        <span className="ov-later-note">Material not added yet</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {tab === "talk" && (
            <div className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[weekScenes.length]) }}>
              <TalkScene projectId={project.id} course={courseLine} summary={talk} busy={running.length > 0 || agentMode === "busy"} reduced={reduced} sceneRef={noRef} enter={entered} />
            </div>
          )}
          {tab === "lecture-notes" && (
            <div className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[weekScenes.length + 1]) }}>
              <WeeksScene projectId={project.id} weeks={weeks} current={currentWeek} reduced={reduced} sceneRef={noRef} enter={entered} />
            </div>
          )}
          {tab === "exam" && (
            <div className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[weekScenes.length + 2]) }}>
              <ExamScene projectId={project.id} exams={exams} sheet={examSheet} reduced={reduced} sceneRef={noRef} enter={entered} />
            </div>
          )}
          {tab === "note-to-self" && (
            <div className="ov-unit" style={{ ["--unit" as string]: rgbCss(accents[weekScenes.length + 3]) }}>
              <StoryScene
                id="ov-note"
                eyebrow="Your study guide"
                title="Note to Self"
                why="Your own writing, collected as you send it from each review: your study guide for the exam."
                status={`${noted}/${progress.total} layers saved`}
                action={
                  <button type="button" className="ov-end-primary" onClick={() => router.push(`/p/${project.id}/notes`)}>
                    Open Note to Self
                  </button>
                }
                art={<NotebookArt saved={noted} total={progress.total} projectId={project.id} />}
                reduced={reduced}
                sceneRef={noRef}
                enter={entered}
              />
            </div>
          )}
        </main>
      )}

      {!locked && (
        <div className="ov-corner">
          <WhileAway items={away} onDismiss={unseen.length ? () => void dismiss() : undefined} />
        </div>
      )}
      {!locked && <DevToggle />}

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

/** The opening scene: the course's name and where you stand in it. */
function Intro({ reduced, title, accent, mode, weekScenes, progress, readyCount, onAgents, sceneRef }: { reduced: boolean; title: string; accent: RGB; mode: AgentMode; weekScenes: SceneWeek[]; progress: ProgressCounts; readyCount: number; onAgents: (t: "note" | "ready") => void; sceneRef: (el: HTMLElement | null) => void }) {
  // The opening leaves by fading and sliding up, the words a little faster than the room behind them, so it keeps the depth of a
  // push-in: CSS animations on the opening's own view timeline (overview.css, .ov-leave), played by the compositor with the scroll.
  const words = title.split(" ");
  const layers = weekScenes.flatMap((x) => x.layers);
  return (
    <section className="ov-intro" ref={sceneRef} aria-labelledby="ov-course">
      <div className={reduced ? "ov-intro-in" : "ov-intro-in ov-leave"}>
        <div className="ov-hall">
          <Hall mode={mode} accent={accent} focus={[0.7, 0.46]} reduced={reduced} caption="Back at the table. Their work is waiting." />
        </div>
        <div className="ov-agents-cta">
          <button type="button" className="ov-ghost" onClick={() => onAgents("note")}>
            Leave a note for the agents
          </button>
          <button type="button" className="ov-agents-link" onClick={() => onAgents("ready")}>
            Ready for you ({readyCount})
          </button>
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
            {progressLabel(progress)}, in course order. {weekScenes.length === 1 ? "One week so far. Scroll to walk through it." : `${weekScenes.length} weeks so far. Scroll to walk through them.`}
          </p>
        </div>
      </div>
    </section>
  );
}

const noRef = () => {};

/**
 * The course's tabs, under the top bar. Each is a real link (its own address, so it opens in a new browser tab too); a plain click
 * switches here without reloading. A short mono status follows the label where there is one.
 */
function CourseTabs({ projectId, tab, status, onSelect }: { projectId: string; tab: CourseTab; status: Partial<Record<CourseTab, string>>; onSelect: (t: CourseTab) => void }) {
  return (
    <nav className="ov-tabs" aria-label="Course sections">
      {TABS.map((t) => (
        <a
          key={t.id}
          id={`ov-tab-${t.id}`}
          href={tabHref(projectId, t.id)}
          className="ov-tab"
          aria-current={t.id === tab ? "page" : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onSelect(t.id);
          }}
        >
          {t.label}
          {status[t.id] && <span className="ov-tab-status">{status[t.id]}</span>}
        </a>
      ))}
    </nav>
  );
}

/** Slim progress rail: one tick per scene, filled to where you are. */
function Rail({ railRef, vp, scenes, ticks, onJump }: { railRef: React.RefObject<HTMLElement | null>; vp: Viewport; scenes: React.RefObject<(HTMLElement | null)[]>; ticks: { id: string; label: string }[]; onJump: (i: number) => void }) {
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
    <nav className="ov-rail" aria-label="Weeks" ref={railRef} style={{ ["--unit-now" as string]: "var(--unit)" }}>
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
  // The spring has visually landed long before it ends (its last few percent take most of its time): the layer opens as soon as the sheet
  // is all but in place, and its frame (LayerFrame) takes over at exactly this spot, so the sheet never sits blank waiting.
  useEffect(() => {
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      done.current();
    };
    const unsub = t.on("change", (v) => v >= 0.97 && open());
    const controls = animate(t, 1, { type: "spring", duration: 0.95, bounce: 0, onComplete: open });
    return () => {
      unsub();
      controls.stop();
    };
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
