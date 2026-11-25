"use client";

import { motion } from "motion/react";
import { useQuietMotion } from "@/lib/lockin/store";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { type CiteHandler } from "@/components/ui/Citation";
import { Markdown } from "@/components/ui/Markdown";
import { Textarea } from "@/components/ui/Input";
import { markTalked } from "@/components/talk/activity";
import type { TalkMessage } from "@/lib/talk/service";
import { readEvents } from "@/lib/ui/sse";

export interface ChatCopy {
  aside: string;
  head: string;
  /** Under the heading. `link` adds the "Open Chat, Sources and Notepad" link. */
  intro: string;
  link?: boolean;
  empty: string;
  ask: string;
  who: string;
  log: string;
}
const TALK_COPY: ChatCopy = {
  aside: "Let's talk!",
  head: "Let’s talk!",
  intro: "One conversation for the whole project, the same here and in the Let’s talk! section.",
  link: true,
  empty: "Ask a question about any reading, week or idea in the course. Answers come from your files and cite the page, and a click on a citation opens the original.",
  ask: "Ask your professor",
  who: "Your professor",
  log: "Conversation with your professor",
};

/** The topic of the student's message before position `i`, so a header shows only where the topic changes. */
function previousTopic(messages: TalkMessage[], i: number): string | null {
  for (let j = i - 1; j >= 0; j--) if (messages[j].role === "user") return messages[j].topic;
  return null;
}

/**
 * Let's talk!: a professor who has read every file of the project. Ask about anything in the course; answers cite
 * [file, p. N] and each citation opens the original. It is ONE conversation per project: the Let's talk! section and the tab inside
 * every layer show the same history. A message sent from a layer (`from`) carries a small subtitle naming it (`fromLabel`, shown
 * until the saved message comes back). `tone="paper"` is the section's version, drawn on its sheet of paper.
 */
export function TalkPane({
  projectId,
  onCite,
  hidden,
  tone = "desk",
  from,
  fromLabel,
  topic,
  onClearTopic,
  topicFor,
  copy = TALK_COPY,
  channel = "talk",
}: {
  projectId: string;
  onCite: CiteHandler;
  hidden?: boolean;
  tone?: "desk" | "paper";
  from?: { layerId?: string; partId?: string };
  fromLabel?: string;
  /** Note to Self: the passage the student highlighted, pinned at the top as the current topic. Every message sent carries it. */
  topic?: string | null;
  onClearTopic?: () => void;
  /** Read when a message is sent: the topic it belongs to (a passage still selected counts), so it can't be stale. */
  topicFor?: () => string | undefined;
  /** The words around the chat. Let's talk! and the Note to Self chat are two conversations with their own header and labels. */
  copy?: ChatCopy;
  /** Which conversation: Let's talk! ("talk") or the Note to Self chat ("note"). Each has its own saved history. */
  channel?: "talk" | "note";
}) {
  const reduced = useQuietMotion();
  const [messages, setMessages] = useState<TalkMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null); // the answer as it arrives; null when not answering
  const [asked, setAsked] = useState<string | null>(null); // the question being answered, shown before it is saved
  const [askedTopic, setAskedTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false); // the "Clear conversation" confirm is open
  const [clearBusy, setClearBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const busy = live !== null;

  const load = async () => {
    const d = (await fetch(`/api/projects/${projectId}/talk?channel=${channel}`).then((r) => r.json()).catch(() => null)) as { messages?: TalkMessage[] } | null;
    return d?.messages ?? null;
  };

  useEffect(() => {
    let gone = false;
    void load().then((m) => {
      if (gone) return;
      if (m) setMessages(m);
      else setError("Margin couldn't load this conversation. Reload the page.");
    });
    return () => {
      gone = true;
      abort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, live, asked]);

  const send = async () => {
    const question = draft.trim();
    if (!question || busy) return;
    setError(null);
    setDraft("");
    const about = topicFor?.() ?? topic ?? undefined;
    setAsked(question);
    setAskedTopic(about ?? null);
    setLive("");
    abort.current = new AbortController();
    try {
      const r = await fetch(`/api/projects/${projectId}/talk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, ...from, topic: about, channel }), signal: abort.current.signal });
      if (!r.ok) {
        setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.");
        setDraft(question); // nothing was answered, so the question is still theirs to send again
      } else {
        if (channel === "talk") markTalked(projectId); // the Librarian reads Let's talk!, not the notebook chat
        await readEvents(r, (d) => {
          if (d.error) setError(d.error);
          else if (d.type === "text" && d.delta) setLive((t) => (t ?? "") + d.delta);
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      abort.current = null;
      const m = await load();
      if (m) {
        setFreshFrom(messages?.length ?? 0);
        setMessages(m);
      }
      setAsked(null);
      setAskedTopic(null);
      setLive(null);
    }
  };

  // One message, for good. A question goes with its reply; the server says which messages went, so the list is simply reloaded.
  const removeMessage = async (m: TalkMessage) => {
    setDeleteError(null);
    const r = await fetch(`/api/projects/${projectId}/talk/messages/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (!r || (!r.ok && r.status !== 404)) return setDeleteError("Margin couldn't delete that message. Try again.");
    const fresh = await load();
    if (fresh) setMessages(fresh);
  };

  const clearAll = async () => {
    setClearBusy(true);
    setDeleteError(null);
    const r = await fetch(`/api/projects/${projectId}/talk?channel=${channel}`, { method: "DELETE" }).catch(() => null);
    setClearBusy(false);
    if (!r?.ok) return setDeleteError("Margin couldn't clear the conversation. Try again.");
    setMessages([]);
    setClearing(false);
  };

  const del = (m: TalkMessage) => (
    <button type="button" className="m-del m-msg-del" aria-label={m.role === "user" ? "Delete this question and its answer" : "Delete this answer"} onClick={() => void removeMessage(m)}>
      Delete
    </button>
  );

  const arrive = (i: number) => (freshFrom !== null && i >= freshFrom ? { initial: { opacity: 0, y: reduced ? 0 : 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: reduced ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] as const } } : { initial: false as const });

  return (
    <aside className={tone === "paper" ? "m-chat m-chat-paper" : "m-chat m-panel surface-desk"} aria-label={copy.aside} hidden={hidden}>
      {tone === "desk" && (
        <header className="m-chat-head">
          <h2>{copy.head}</h2>
          <p>
            {copy.intro} {copy.link && <Link href={`/p/${projectId}/talk`}>Open Chat, Sources and Notepad</Link>}
          </p>
        </header>
      )}

      {messages && messages.length > 0 && !busy && (
        <div className="m-chat-bar">
          <button type="button" className="m-chat-clear" onClick={() => setClearing(true)}>
            Clear conversation
          </button>
        </div>
      )}

      {topic && (
        <div className="m-topic m-topic-now" aria-label="The passage we are talking about">
          <span className="m-topic-label">Talking about</span>
          <blockquote>{topic}</blockquote>
          {onClearTopic && (
            <button type="button" className="m-topic-clear" onClick={onClearTopic}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="m-chat-list" ref={list} role="log" aria-live="polite" aria-busy={busy} aria-label={copy.log}>
        {messages && messages.length === 0 && !asked && (
          <p className="t-ui m-write-empty">{copy.empty}</p>
        )}
        {messages?.map((m, i) =>
          m.role === "user" ? (
            <motion.div key={m.id} className="m-msg" data-kind="user" {...arrive(i)}>
              {m.topic && m.topic !== previousTopic(messages, i) && (
                <div className="m-topic">
                  <span className="m-topic-label">About this passage</span>
                  <blockquote>{m.topic}</blockquote>
                </div>
              )}
              {m.context && <span className="m-msg-context">{m.context}</span>}
              <p className="m-write-text">{m.content}</p>
              {!busy && del(m)}
            </motion.div>
          ) : (
            <motion.div key={m.id} className="m-msg m-slip" data-kind="tutor" {...arrive(i)}>
              <span className="m-msg-label">{copy.who}</span>
              <div className="m-write-text">
                <Markdown text={m.content} onCite={onCite} />
              </div>
              {!busy && del(m)}
            </motion.div>
          ),
        )}
        {asked && (
          <div className="m-msg" data-kind="user">
            {askedTopic && askedTopic !== previousTopic(messages ?? [], (messages ?? []).length) && (
              <div className="m-topic">
                <span className="m-topic-label">About this passage</span>
                <blockquote>{askedTopic}</blockquote>
              </div>
            )}
            {fromLabel && <span className="m-msg-context">{fromLabel}</span>}
            <p className="m-write-text">{asked}</p>
          </div>
        )}
        {busy && (
          <div className="m-msg m-slip" data-kind="tutor">
            <span className="m-msg-label">{copy.who}</span>
            <div className="m-write-text">{live ? <Markdown text={live} onCite={onCite} /> : <p>Looking through your files…</p>}</div>
          </div>
        )}
      </div>

      <div className="m-chat-foot">
        {deleteError && !clearing && (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {deleteError}
          </p>
        )}
        {error && (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <Textarea
          label={copy.ask}
          placeholder={copy.ask}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          hint="Enter sends, Shift+Enter makes a new line."
        />
        <div className="m-act-row">
          <Button variant="accent" onClick={() => void send()} disabled={!draft.trim() || busy}>
            Ask
          </Button>
          {busy && (
            <Button variant="quiet" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={clearing}
        title="Clear this conversation?"
        confirmLabel="Clear conversation"
        busy={clearBusy}
        error={clearing ? deleteError : null}
        onConfirm={() => void clearAll()}
        onCancel={() => {
          setClearing(false);
          setDeleteError(null);
        }}
      >
        <p>
          This permanently deletes every message in {channel === "note" ? "the Note to Self chat" : "Let’s talk!"} for this project. {channel === "note" ? "Your notes and write-ups are not touched." : "Sources the Librarian already collected stay until you delete them."} It cannot be undone.
        </p>
      </ConfirmDialog>
    </aside>
  );
}
