"use client";

import Link from "next/link";
import { useState } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { Segmented } from "@/components/ui/Segmented";
import { LayerList } from "@/components/layers/LayerList";
import { SourceViewer, type CiteTarget } from "@/components/layers/SourceViewer";
import { TalkPane } from "@/components/layers/TalkPane";
import type { StructureModel } from "@/lib/layers/types";
import { useCollectOnLeave } from "./activity";
import { NotepadTab } from "./NotepadTab";
import { SourcesTab } from "./SourcesTab";

export type TalkTab = "chat" | "sources" | "notepad";
const OPTIONS: { value: TalkTab; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "sources", label: "Sources" },
  { value: "notepad", label: "Notepad" },
];

/**
 * Let's talk!: the project-level section beside Part A and Part B. Chat is the one conversation for the project (the tab inside every
 * layer continues it), Sources is what the Librarian collected from it, Notepad is one page of my own notes. Same three-pane
 * shell as the workspace; the right pane is left out because the sheet itself is the work.
 */
export function TalkSection({ model, initialTab }: { model: StructureModel; initialTab: TalkTab }) {
  const [tab, setTab] = useState<TalkTab>(initialTab);
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const projectId = model.project.id;
  useCollectOnLeave(projectId);
  const cite = (page: number, file: string, near?: string) => setCited({ file, page, near });
  const choose = (t: TalkTab) => {
    setTab(t);
    window.history.replaceState(null, "", `/p/${projectId}/talk?tab=${t}`);
  };

  return (
    <>
      <Workspace
        leftTitle="Layers"
        listName="layer list"
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
              Let&rsquo;s talk!
            </span>
          </>
        }
        left={<LayerList model={model} activeId="talk" />}
        leftFooter={
          <>
            <Link href={`/p/${projectId}/notes`} className="m-left-link">
              <span>Note to Self</span>
            </Link>
            <Link href={`/p/${projectId}/talk`} className="m-left-link" aria-current="page">
              <span>Let&rsquo;s talk!</span>
            </Link>
          </>
        }
      >
        <section className="m-paper m-reading-pane m-tt" aria-label="Let’s talk!">
          <div className="m-tt-head">
            <div>
              <p className="m-part-tag">{model.project.name}</p>
              <h1 className="t-h1">Let&rsquo;s talk!</h1>
            </div>
            <Segmented label="Let’s talk! sections" idPrefix="talk-tab" panelId={`talk-panel-${tab}`} value={tab} onChange={choose} options={OPTIONS} />
          </div>
          {tab === "chat" && (
            <div className="m-tt-chat" role="tabpanel" id="talk-panel-chat" aria-labelledby="talk-tab-chat">
              <TalkPane projectId={projectId} onCite={cite} tone="paper" />
            </div>
          )}
          {tab === "sources" && <SourcesTab projectId={projectId} onCite={cite} />}
          {tab === "notepad" && <NotepadTab projectId={projectId} />}
        </section>
      </Workspace>
      <SourceViewer projectId={projectId} target={cited} onClose={() => setCited(null)} />
    </>
  );
}
