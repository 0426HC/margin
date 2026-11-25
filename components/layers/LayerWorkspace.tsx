"use client";

import Link from "next/link";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Workspace } from "@/components/workspace/Workspace";
import { arrival } from "@/lib/layout/panes";
import { noteOpening, openingDone, rememberCourse } from "@/lib/layers/frame-peek";
import { flattenLayers, neighbours, positionLabel } from "@/lib/layers/order";
import type { LayerView, StructureModel } from "@/lib/layers/types";
import type { ViewMode } from "@/lib/layers/view-mode";
import { CommandBar } from "./CommandBar";
import { LayerLinks } from "./LayerLinks";
import { LayerList } from "./LayerList";
import { UpdatesDialog } from "@/components/updates/UpdatesDialog";
import type { LectureTab } from "@/lib/lecture/service";
import { readExplained } from "@/lib/layers/explained-text";
import { LayerReading } from "./LayerReading";
import { LayerFailed, LayerProgress } from "./LayerProgress";
import type { LayerProgress as Progress, LayerStep } from "@/lib/layers/layer-progress";
import type { LectureStatus } from "./LectureView";
import type { LayerTab } from "./reading-parts";
import { SourceViewer, type CiteTarget } from "./SourceViewer";
import { RightPane, useRightTab } from "./RightPane";
import { useCollectOnLeave } from "@/components/talk/activity";
import { TalkPane } from "./TalkPane";
import { WriteBack } from "./WriteBack";

type Writing = "idle" | "writing" | "error";

/**
 * One layer in the three-pane workspace: the layer list, Explained | Source, and (soon) the write-back. Calm on purpose:
 * the only motion is the tab swap, pane collapse and the panes settling once after the zoom.
 */
export function LayerWorkspace({ model, layer, lecture, initialTab }: { model: StructureModel; layer: LayerView; lecture: LectureTab; initialTab: ViewMode }) {
  const router = useRouter();
  const [tab, setTab] = useState<LayerTab>(initialTab);
  const [rightTab, setRightTab] = useRightTab();
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const [writing, setWriting] = useState<Writing>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [skew, setSkew] = useState(0);
  const [kept, setKept] = useState<LayerStep[]>([]);
  const [bar, setBar] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lectureStatus, setLectureStatus] = useState<LectureStatus>({ state: "idle" });
  const lectureAsked = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [arrived] = useState(() => arrival.layerId === layer.id);
  const scrolls = useRef<Record<LayerTab, number>>({ explained: 0, lecture: 0, source: 0 });
  // While the tab swaps, the old content leaves and the page height shrinks, which makes the browser fire scroll events that
  // are not the reader's. They are ignored until the new tab has mounted and its own position is put back.
  const switching = useRef(false);
  // the open answer that follows the writing; closed when the student leaves the layer (the writing itself goes on and is saved)
  const following = useRef<AbortController | null>(null);

  const flat = useMemo(() => flattenLayers(model), [model]);
  const { prev, next } = neighbours(flat, layer.id);
  const here = flat.find((l) => l.id === layer.id);
  const gated = layer.week.status !== "approved";
  const placeInWeek = (model.weeks.find((w) => w.layers.some((l) => l.id === layer.id))?.layers.findIndex((l) => l.id === layer.id) ?? 0) + 1;
  useCollectOnLeave(model.project.id, rightTab === "talk");
  const needsWriting = !gated && (!layer.content || layer.contentStatus === "stale");

  useEffect(() => {
    if (arrival.layerId === layer.id) arrival.layerId = null;
    openingDone(layer.id);
  }, [layer.id]);
  // the next layer opened from here draws its frame at once from this structure
  useEffect(() => rememberCourse(model), [model]);

  // The answer streams the work's progress (which step it is on), then done or what went wrong. Never a spinner with no end: the server
  // stops after its limit and says so, and a dropped connection is said plainly.
  const follow = useCallback(async () => {
    following.current?.abort();
    const ctl = new AbortController();
    following.current = ctl;
    const failed = (message: string) => {
      if (ctl.signal.aborted) return;
      setError(message);
      setWriting("error");
    };
    try {
      const r = await fetch(`/api/layers/${layer.id}/write`, { method: "POST", signal: ctl.signal });
      if (!r.ok || !r.body) return failed(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.");
      if (!r.headers.get("content-type")?.includes("ndjson")) {
        setWriting("idle");
        return router.refresh();
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: "progress"; progress: Progress; now: number } | { type: "done" } | { type: "error"; error: string };
          if (ev.type === "progress") {
            setSkew(ev.now - Date.now());
            setProgress(ev.progress);
            if (ev.progress.outcome && !ev.progress.outcome.ok) setKept(ev.progress.outcome.kept);
          } else if (ev.type === "done") {
            setWriting("idle");
            return router.refresh();
          } else return failed(ev.error);
        }
      }
      failed("Margin lost the connection while writing this layer. Check that the app is still running, then try again; anything already finished is kept.");
    } catch {
      failed("Margin lost the connection. Check that the app is still running, then try again.");
    }
  }, [layer.id, router]);

  // "Refresh this layer": write Explained again from everything the layer holds now. The student's write-up is never touched.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await fetch(`/api/layers/${layer.id}/refresh`, { method: "POST" });
      if (r.ok) router.refresh();
      else setRefreshError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.");
    } catch {
      setRefreshError("Margin lost the connection. Check that the app is still running, then try again.");
    }
    setRefreshing(false);
  }, [layer.id, router]);

  // Follow the writing while this layer is on screen. Leaving it closes the answer, so open connections never pile up; coming back (Next
  // shows a page the student left again, rather than making it anew) opens it again and picks up the text so far.
  useEffect(() => {
    if (!needsWriting) return;
    const start = setTimeout(() => void follow(), 0);
    return () => {
      clearTimeout(start);
      following.current?.abort();
    };
  }, [needsWriting, follow]);

  // Try again: from a clean slate
  const retry = () => {
    setWriting("writing");
    setError(null);
    setProgress(null);
    setKept([]);
    void follow();
  };

  // The Lecture tab is written the first time it is opened (to save cost), and its class-notes section again when the lecture notes changed.
  const writeLecture = useCallback(async () => {
    setLectureStatus({ state: "writing" });
    try {
      const r = await fetch(`/api/layers/${layer.id}/lecture`, { method: "POST" });
      if (r.ok) {
        setLectureStatus({ state: "idle" });
        router.refresh();
        return;
      }
      setLectureStatus({ state: "error", error: ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again." });
    } catch {
      setLectureStatus({ state: "error", error: "Margin lost the connection. Check that the app is still running, then try again." });
    }
  }, [layer.id, router]);

  const needsLecture = tab === "lecture" && !gated && lecture.files.length > 0 && (!lecture.content || lecture.notesStale);
  useEffect(() => {
    if (!needsLecture || lectureAsked.current) return;
    lectureAsked.current = true;
    void writeLecture();
  }, [needsLecture, writeLecture]);

  const choose = (t: LayerTab) => {
    if (t === tab) return;
    const el = document.querySelector<HTMLElement>(".m-scroll");
    if (el) scrolls.current[tab] = el.scrollTop;
    switching.current = true;
    setTab(t);
    void fetch(`/api/layers/${layer.id}/view`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: t }) }).catch(() => undefined);
  };

  // A citation anywhere opens the original page in the slide-over, with the cited passage marked.
  const cite = (page: number, file: string, near?: string) => setCited({ file, page, near });

  const restoreScroll = useCallback((t: LayerTab) => {
    const el = document.querySelector<HTMLElement>(".m-scroll");
    if (el) el.scrollTop = scrolls.current[t];
    switching.current = false;
  }, []);

  // Keyboard: [ and ] (or K and J) move between layers, across weeks; Cmd or Ctrl K opens the command bar. Nothing animates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBar((b) => !b);
        return;
      }
      if (e.key === "Escape" && bar) {
        setBar(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (bar || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable='true'], [role='tab']")) return;
      const to = e.key === "]" || e.key === "j" ? next : e.key === "[" || e.key === "k" ? prev : undefined;
      if (to) {
        const href = `/p/${model.project.id}/l/${to.id}`;
        noteOpening(href);
        router.push(href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bar, next, prev, router, model.project.id]);

  const content = layer.content;
  // while it is written, the explanation so far, section by section
  const draft = useMemo(() => (!content && progress?.text ? readExplained(progress.text, { final: false }) : null), [content, progress?.text]);
  return (
    <>
      <Workspace
        arrive={arrived}
        leftTitle="Layers"
        listName="layer list"
        rightName="write-back pane"
        topbar={
          <>
            <BackToCourse projectId={model.project.id} course={model.project.name} own="layers" />
            <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
              {positionLabel(flat, layer.id)}
            </span>
            <Button variant="quiet" onClick={() => setBar(true)} aria-label="Open the command bar" aria-keyshortcuts="Meta+K Control+K">
              Search <span className="t-label">⌘K</span>
            </Button>
          </>
        }
        left={<LayerList model={model} activeId={layer.id} />}
        leftFooter={<LayerLinks projectId={model.project.id} onTalk={() => setRightTab("talk")} />}
        right={
          <RightPane
            tab={rightTab}
            onTab={setRightTab}
            writeLabel="Write it back"
            write={<WriteBack key={layer.id} base={`/api/layers/${layer.id}`} draftId={layer.id} state={here?.state ?? "not_saved"} onCite={cite} />}
            talk={<TalkPane projectId={model.project.id} onCite={cite} from={{ layerId: layer.id }} fromLabel={`From Week ${layer.week.week}, layer ${placeInWeek}: ${layer.title}`} />}
          />
        }
      >
        <LayerReading
          projectId={model.project.id}
          layerId={layer.id}
          lecture={lecture}
          lectureStatus={lectureStatus}
          onAddFiles={() => setAdding(true)}
          onRetryLecture={() => void writeLecture()}
          partLabel={here ? here.weekLabel : layer.week.label}
          title={layer.title}
          bigQuestion={layer.bigQuestion}
          tab={tab}
          onTab={choose}
          explained={content?.explained ?? null}
          draft={writing !== "error" ? draft : null}
          source={content?.source ?? null}
          optional={layer.optional}
          onCite={cite}
          minutes={here?.minutes ?? 1}
          onScroll={(top) => {
            if (!switching.current) scrolls.current[tab] = top;
          }}
          restoreScroll={restoreScroll}
        >
          {layer.newMaterial && content && (
            <div className="m-fresh" role="status">
              <p>
                <b>New material since you saved.</b> Files were added to this layer after its tabs were written. Your write-up stays exactly as you saved it.
              </p>
              <Button variant="accent" onClick={() => void refresh()} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh this layer"}
              </Button>
              {refreshError && (
                <p className="m-field-error" role="alert">
                  {refreshError}
                </p>
              )}
            </div>
          )}
          {gated && (
            <p className="m-note" role="status">
              The course plan isn&rsquo;t approved yet, so nothing is written. <Link href={`/p/${model.project.id}/setup`}>Approve it first.</Link>
            </p>
          )}
          {!gated && !content && writing !== "error" && <LayerProgress progress={progress} skew={skew} reading={!!draft} />}
          {writing === "error" && <LayerFailed message={error ?? "That didn't work. Try again."} kept={kept} onRetry={retry} />}
        </LayerReading>
      </Workspace>
      <SourceViewer projectId={model.project.id} target={cited} onClose={() => setCited(null)} />
      <UpdatesDialog projectId={model.project.id} isDemo={model.project.isDemo} mode={adding ? "files" : null} onClose={() => setAdding(false)} />
      {bar && <CommandBar model={model} onClose={() => setBar(false)} />}
    </>
  );
}
