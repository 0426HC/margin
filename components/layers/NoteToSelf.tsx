"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Stage } from "@/components/cinematic/Stage";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Notebook } from "@/components/notebook/Notebook";
import { useSelectionAsk } from "@/components/notebook/useSelectionAsk";
import type { NoteGuide } from "@/lib/layers/note-to-self";
import { SourceViewer, type CiteTarget } from "./SourceViewer";
import { TalkPane, type ChatCopy } from "./TalkPane";

/** The Note to Self chat is its own conversation, not Let's talk!: its own header, labels and history. */
const NOTES_COPY: ChatCopy = {
  aside: "Notebook chat",
  head: "Ask about your notes",
  intro: "Its own conversation, separate from Let’s talk!. It knows your course files, your saved write-ups and your quick notes. Select text on a page, then ask about it.",
  empty: "Select some of your writing and ask about it, for example how to write it more thoroughly. Or ask about anything in the course. Answers cite the page.",
  ask: "Ask about your notes",
  who: "Notes guide",
  log: "Conversation about your notes",
}

const onNarrow = (notify: () => void) => {
  const q = window.matchMedia("(max-width: 760px)");
  q.addEventListener("change", notify);
  return () => q.removeEventListener("change", notify);
};

/** The navy cover that swings open when Note to Self is opened. Gone for good once it has opened. */
function Cover({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <div className="nb-cover" aria-hidden="true" onAnimationEnd={(e) => e.animationName === "nb-open" && onDone()}>
      <div className="nb-cover-face">
        <p className="nb-cover-title">Note to Self</p>
        <p className="nb-cover-sub">{name}</p>
      </div>
    </div>
  );
}

/**
 * Note to Self as a notebook: one long page in two columns (blank quick notes, ruled saved write-ups), every layer in course order.
 * The chat sits fixed on the right and scrolls on its own; selecting text in either column offers "Ask about this", which pins that
 * passage as the chat's topic until something else is highlighted.
 */
export function NoteToSelf({ guide }: { guide: NoteGuide }) {
  const reduced = useReducedSafe();
  const { project, parts, resume } = guide;
  const [cover, setCover] = useState(true);
  // on a phone-width screen the chat starts closed, so the notebook is not covered; once toggled, the choice stands
  const narrow = useSyncExternalStore(onNarrow, () => window.matchMedia("(max-width: 760px)").matches, () => false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const chatOpen = chosen ?? !narrow;
  const [topic, setTopic] = useState<string | null>(null);
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const book = useRef<HTMLDivElement>(null);
  const [picked, clearPicked] = useSelectionAsk(book);
  // the chat reads these at send time, so a passage that is selected while typing still counts
  const topicRef = useRef<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  useEffect(() => {
    topicRef.current = topic;
    pickedRef.current = picked?.text ?? null;
  }, [topic, picked]);

  const pin = useCallback(
    (text: string) => {
      setTopic(text);
      topicRef.current = text;
      clearPicked();
      window.getSelection()?.removeAllRanges();
      setChosen(true);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".nb-chat textarea")?.focus());
    },
    [clearPicked],
  );
  const topicFor = useCallback(() => {
    const next = pickedRef.current ?? topicRef.current;
    if (next && next !== topicRef.current) {
      setTopic(next);
      topicRef.current = next;
    }
    if (pickedRef.current) clearPicked();
    return next ?? undefined;
  }, [clearPicked]);

  return (
    <Stage
      seed={project.name}
      count={parts.length + 1}
      at={parts.length}
      course={project.name}
      action={
        resume && (
          <Link href={`/p/${project.id}/l/${resume.layerId}`} className="ov-continue">
            Continue with {resume.title}
          </Link>
        )
      }
    >
      <main className="nb" data-chat={chatOpen ? "open" : "closed"}>
        <div className="nb-stage">
          <div className="nb-book m-paper" data-raised ref={book}>
            <h1 className="sr-only">Note to Self</h1>
            <div className="nb-margin" data-side="left" aria-hidden="true" />
            <div className="nb-margin" data-side="right" aria-hidden="true" />
            <div className="nb-spine" aria-hidden="true" />
            {guide.finished === 0 && <p className="sr-only">Nothing has been sent to Note to Self yet.</p>}
            <Notebook projectId={project.id} parts={parts} />
          </div>
          {!reduced && cover && <Cover name={project.name} onDone={() => setCover(false)} />}
        </div>

        <aside className="nb-chat" aria-label="Ask about your notes" data-open={chatOpen ? "" : undefined}>
          <button type="button" className="nb-chat-toggle" aria-expanded={chatOpen} onClick={() => setChosen(!chatOpen)}>
            {chatOpen ? "Hide chat" : "Ask"}
          </button>
          <div className="nb-chat-body" hidden={!chatOpen}>
            <TalkPane
              projectId={project.id}
              onCite={(page, file, near) => setCited({ file, page, near })}
              topic={topic}
              onClearTopic={() => setTopic(null)}
              topicFor={topicFor}
              copy={NOTES_COPY}
              channel="note"
            />
          </div>
        </aside>
      </main>

      {picked && (
        <button
          type="button"
          className="nb-ask"
          style={{ left: picked.x, top: picked.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pin(picked.text)}
        >
          Ask about this
        </button>
      )}
      <SourceViewer projectId={project.id} target={cited} onClose={() => setCited(null)} />
    </Stage>
  );
}
