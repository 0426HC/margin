"use client";

import Link from "next/link";
import { useState } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { LayerMark } from "@/components/ui/LayerMark";
import type { GuideSlot } from "@/lib/layers/note-to-self";
import type { StructureModel } from "@/lib/layers/types";
import { LayerList } from "./LayerList";
import { RightPane, useRightTab } from "./RightPane";
import { SourceViewer, type CiteTarget } from "./SourceViewer";
import { useCollectOnLeave } from "@/components/talk/activity";
import { TalkPane } from "./TalkPane";
import { WriteBack } from "./WriteBack";

/**
 * A Part synthesis in the same three panes as a layer: the layer list, the Part's layers in my own words to write from, and the
 * same write-back loop. Never locked: unfinished layers are noted, not required.
 */
export function SynthesisWorkspace({ model, partId, question, layers }: { model: StructureModel; partId: string; question: string; layers: GuideSlot[] }) {
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const [rightTab, setRightTab] = useRightTab();
  const part = model.parts.find((p) => p.id === partId)!;
  const projectId = model.project.id;
  const open = layers.filter((l) => !l.final);
  const gated = part.status !== "approved";
  useCollectOnLeave(projectId, rightTab === "talk");

  // A citation in the feedback opens the original page in the slide-over, with the cited passage marked.
  const cite = (page: number, file: string, near?: string) => setCited({ file, page, near });

  return (
    <>
    <Workspace
      leftTitle="Layers"
      listName="layer list"
      rightName="synthesis pane"
      topbar={
        <>
          <Link href={`/p/${projectId}`} className="t-h3" style={{ letterSpacing: "-0.02em" }} aria-label="Margin, back to the course overview">
            Margin
          </Link>
          <span className="t-label text-panel-muted">
            {model.project.courseCode && !model.project.name.startsWith(model.project.courseCode) ? `${model.project.courseCode}, ` : ""}
            {model.project.name}
          </span>
          <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
            {part.title}, synthesis
          </span>
        </>
      }
      left={<LayerList model={model} activeId={`synthesis-${partId}`} />}
      leftFooter={
        <>
          <Link href={`/p/${projectId}/notes`} className="m-left-link">
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
          writeLabel="Write the synthesis"
          write={gated ? <aside className="m-chat m-panel surface-desk" aria-label="Write the synthesis"><p className="t-ui m-write-empty" style={{ padding: 18 }}>Approve this Part’s layers first, then write its synthesis.</p></aside> : <WriteBack key={partId} kind="synthesis" base={`/api/parts/${partId}/synthesis`} draftId={`synthesis-${partId}`} state={part.synthesis} onCite={cite} />}
          talk={<TalkPane projectId={projectId} onCite={cite} from={{ partId }} fromLabel={`From ${part.title} synthesis`} />}
        />
      }
    >
      <section className="m-paper m-reading-pane" aria-label={`${part.title} synthesis`}>
        <div className="m-scroll">
          <div className="m-reading">
            <header className="m-head">
              <p className="m-part-tag">{part.title}</p>
              <h1 className="t-h1">{part.title} synthesis</h1>
              <p className="m-subtitle">{question}</p>
            </header>
            {gated ? (
              <p className="m-note" role="status">
                This Part&rsquo;s layers aren&rsquo;t approved yet. <Link href={`/p/${projectId}/setup`}>Approve them first.</Link>
              </p>
            ) : (
              <p className="m-note" role="status">
                {open.length === 0
                  ? "Every layer of this Part is saved to Note to Self. Write one piece that pulls them into a single argument: what each layer adds, and how they build on each other."
                  : open.length === layers.length
                    ? "None of this Part’s layers is saved yet. You can write the synthesis now; the review will point out what is missing."
                    : `${open.length} of ${layers.length} layers aren’t saved yet. You can write the synthesis now; the review will point out what is missing.`}
              </p>
            )}
            <div className="m-synth-layers">
              <h2 className="m-synth-h">Your layers, in your own words</h2>
              {layers.map((l, i) => (
                <article key={l.id} className="m-gutter-row m-synth-layer" data-waiting={l.final ? undefined : ""}>
                  <p className="m-margin-note m-synth-side">
                    <LayerMark state={l.state} withLabel />
                    <span>Layer {i + 1}</span>
                  </p>
                  <div className="min-w-0">
                    <h3 className="m-synth-title">
                      <Link href={`/p/${projectId}/l/${l.id}`}>{l.title}</Link>
                    </h3>
                    {l.bigQuestion && <p className="m-synth-q">{l.bigQuestion}</p>}
                    {l.final ? (
                      <div className="m-synth-text">
                        {l.final.text.split(/\n{2,}/).map((para, k) => (
                          <p key={k}>{para}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="m-synth-q">
                        Not saved yet. <Link href={`/p/${projectId}/l/${l.id}`}>Open the layer</Link>
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Workspace>
    <SourceViewer projectId={projectId} target={cited} onClose={() => setCited(null)} />
    </>
  );
}
