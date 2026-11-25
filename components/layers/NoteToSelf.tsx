"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Stage } from "@/components/cinematic/Stage";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Notebook } from "@/components/notebook/Notebook";
import { PlainNotes } from "@/components/notebook/PlainNotes";
import { useHydrated } from "@/components/cinematic/useHydrated";
import { useLockIn } from "@/lib/lockin/store";
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

/** The navy cover that swings open each time Note to Self is opened. Gone once it has opened, until the next visit. */
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
export function NoteToSelf({ guide, embedded = false }: { guide: NoteGuide; embedded?: boolean }) {
  const reduced = useReducedSafe();
  const { project, weeks, resume } = guide;
  const [cover, setCover] = useState(true);
  // Next keeps a visited page alive (hidden in <Activity>), so its state survives; effects run again each time it is shown, so the
  // cover is put back on every visit, from the tab, the sidebar or any link.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the reset must happen before the page is painted again
  useLayoutEffect(() => setCover(true), []);
  // Lock in: the same notes and write-ups as plain columns, no book. The page as sent carries both; the CSS shows the one that fits.
  const locked = useLockIn();
  const hydrated = useHydrated();
  // on a phone-width screen the chat starts closed, so the notebook is not covered; once toggled, the choice stands
  const narrow = useSyncExternalStore(onNarrow, () => window.matchMedia("(max-width: 760px)").matches, () => false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const chatOpen = chosen ?? !narrow;
  const [topic, setTopic] = useState<string | null>(null);
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const book = useRef<HTMLDivElement>(null);
  const plainPages = useRef<HTMLDivElement>(null);
  // highlight to ask works on whichever pages are shown; a new ref re-attaches the listener when the mode changes
  const [picked, clearPicked] = useSelectionAsk(locked ? plainPages : book);
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

  const chat = (
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
  );

  const body = (
    <>
      {(!locked || !hydrated) && (
        <main className="nb" data-chat={chatOpen ? "open" : "closed"}>
          <div className="nb-stage">
            <div className="nb-book m-paper" data-raised ref={book}>
              <h1 className="sr-only">Note to Self</h1>
              <div className="nb-margin" data-side="left" aria-hidden="true" />
              <div className="nb-margin" data-side="right" aria-hidden="true" />
              <div className="nb-spine" aria-hidden="true" />
              {guide.finished === 0 && <p className="sr-only">Nothing has been sent to Note to Self yet.</p>}
              <Notebook projectId={project.id} weeks={weeks} condensed={guide.condensed} />
            </div>
            {!reduced && cover && <Cover name={project.name} onDone={() => setCover(false)} />}
          </div>
          {chat}
        </main>
      )}
      {(locked || !hydrated) && (
        // lock in: notes | a thin line | write-ups | the same chat, in the same place, with the same Hide chat button
        <main className="lk-nts" data-chat={chatOpen ? "open" : "closed"}>
          <PlainNotes projectId={project.id} weeks={weeks} condensed={guide.condensed} pagesRef={plainPages} />
          {chat}
        </main>
      )}

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
    </>
  );
  // inside the course page (the Note to Self tab in lock in) the course's own top bar and tabs are above it
  if (embedded) return body;
  return (
    <Stage
      seed={project.name}
      count={weeks.length + 1}
      at={weeks.length}
      course={project.name}
      back={<BackToCourse projectId={project.id} course={project.name} own="note-to-self" />}
      action={
        resume && (
          <Link href={`/p/${project.id}/l/${resume.layerId}`} className="ov-continue">
            Continue with {resume.title}
          </Link>
        )
      }
    >
      {body}
    </Stage>
  );
}
