"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Workspace } from "@/components/workspace/Workspace";
import { arrival } from "@/lib/layout/panes";
import { flattenLayers, neighbours, positionLabel } from "@/lib/layers/order";
import type { LayerView, StructureModel } from "@/lib/layers/types";
import type { ViewMode } from "@/lib/layers/view-mode";
import { CommandBar } from "./CommandBar";
import { LayerList } from "./LayerList";
import { LayerReading, type LayerTab } from "./LayerReading";
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
export function LayerWorkspace({ model, layer, initialTab }: { model: StructureModel; layer: LayerView; initialTab: ViewMode }) {
  const router = useRouter();
  const [tab, setTab] = useState<LayerTab>(initialTab);
  const [rightTab, setRightTab] = useRightTab();
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const [writing, setWriting] = useState<Writing>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bar, setBar] = useState(false);
  const [arrived] = useState(() => arrival.layerId === layer.id);
  const scrolls = useRef<Record<LayerTab, number>>({ explained: 0, source: 0 });
  // While the tab swaps, the old content leaves and the page height shrinks, which makes the browser fire scroll events that
  // are not the reader's. They are ignored until the new tab has mounted and its own position is put back.
  const switching = useRef(false);
  const asked = useRef(false);

  const flat = useMemo(() => flattenLayers(model), [model]);
  const { prev, next } = neighbours(flat, layer.id);
  const here = flat.find((l) => l.id === layer.id);
  const gated = layer.part.status !== "approved";
  const placeInPart = (model.parts.find((p) => p.layers.some((l) => l.id === layer.id))?.layers.findIndex((l) => l.id === layer.id) ?? 0) + 1;
  useCollectOnLeave(model.project.id, rightTab === "talk");
  const needsWriting = !gated && (!layer.content || layer.contentStatus === "stale");

  useEffect(() => {
    if (arrival.layerId === layer.id) arrival.layerId = null;
  }, [layer.id]);

  const write = useCallback(async () => {
    setWriting("writing");
    setError(null);
    try {
      const r = await fetch(`/api/layers/${layer.id}/write`, { method: "POST" });
      if (r.ok) {
        setWriting("idle");
        router.refresh();
        return;
      }
      setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.");
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    }
    setWriting("error");
  }, [layer.id, router]);

  useEffect(() => {
    if (!needsWriting || asked.current) return;
    asked.current = true;
    void write();
  }, [needsWriting, write]);

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

  // Keyboard: [ and ] (or K and J) move between layers, across both Parts; Cmd or Ctrl K opens the command bar. Nothing animates.
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
      if (to) router.push(`/p/${model.project.id}/l/${to.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bar, next, prev, router, model.project.id]);

  const content = layer.content;
  return (
    <>
      <Workspace
        arrive={arrived}
        leftTitle="Layers"
        listName="layer list"
        rightName="write-back pane"
        topbar={
          <>
            <Link href={`/p/${model.project.id}`} className="t-h3" style={{ letterSpacing: "-0.02em" }} aria-label="Margin, back to the course overview">
              Margin
            </Link>
            <span className="t-label text-panel-muted">
              {model.project.courseCode && !model.project.name.startsWith(model.project.courseCode) ? `${model.project.courseCode}, ` : ""}
              {model.project.name}
            </span>
            <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
              {positionLabel(flat, layer.id)}
            </span>
            <Button variant="quiet" onClick={() => setBar(true)} aria-label="Open the command bar" aria-keyshortcuts="Meta+K Control+K">
              Search <span className="t-label">⌘K</span>
            </Button>
          </>
        }
        left={<LayerList model={model} activeId={layer.id} />}
        leftFooter={
          <>
            <Link href={`/p/${model.project.id}/notes`} className="m-left-link">
              <span>Note to Self</span>
            </Link>
            <button type="button" className="m-left-link" onClick={() => setRightTab("talk")}>
              <span>Let&rsquo;s talk!</span>
            </button>
          </>
        }
        right={
          <RightPane
            tab={rightTab}
            onTab={setRightTab}
            writeLabel="Write it back"
            write={<WriteBack key={layer.id} base={`/api/layers/${layer.id}`} draftId={layer.id} state={here?.state ?? "not_saved"} onCite={cite} />}
            talk={<TalkPane projectId={model.project.id} onCite={cite} from={{ layerId: layer.id }} fromLabel={`From Layer ${placeInPart}: ${layer.title}`} />}
          />
        }
      >
        <LayerReading
          partLabel={here ? `${here.partTitle}` : `Part ${layer.part.key}`}
          title={layer.title}
          bigQuestion={layer.bigQuestion}
          tab={tab}
          onTab={choose}
          explained={content?.explained ?? null}
          source={content?.source ?? null}
          onCite={cite}
          minutes={here?.minutes ?? 1}
          onScroll={(top) => {
            if (!switching.current) scrolls.current[tab] = top;
          }}
          restoreScroll={restoreScroll}
        >
          {gated && (
            <p className="m-note" role="status">
              This Part&rsquo;s layers aren&rsquo;t approved yet, so nothing is written. <Link href={`/p/${model.project.id}/setup`}>Approve them first.</Link>
            </p>
          )}
          {!gated && !content && writing !== "error" && (
            <p className="m-note" role="status">
              Writing this layer. The first time takes about a minute; after that it opens at once.
            </p>
          )}
          {writing === "error" && (
            <div className="m-note" role="alert">
              <p>{error}</p>
              <Button variant="accent" onClick={() => void write()}>
                Try again
              </Button>
            </div>
          )}
        </LayerReading>
      </Workspace>
      <SourceViewer projectId={model.project.id} target={cited} onClose={() => setCited(null)} />
      {bar && <CommandBar model={model} onClose={() => setBar(false)} />}
    </>
  );
}
