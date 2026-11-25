"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Segmented } from "@/components/ui/Segmented";
import { splitCitations } from "@/lib/ai/citations";
import type { AgentId } from "@/lib/agents/tasks";
import type { AgentDocBlock } from "@/lib/agents/types";

export interface RequestItem {
  id: string;
  agent: AgentId;
  text: string;
  status: "running" | "done" | "declined" | "failed";
  title: string | null;
  note: string | null;
  createdAt: number;
}
export interface RequestsData {
  ready: RequestItem[];
  open: RequestItem[];
  remaining: number;
  limit: number;
}

const NAME: Record<AgentId, string> = { explainer: "the Explainer", quizzer: "the Quizzer", examiner: "the Examiner", connector: "the Connector", librarian: "the Librarian" };
const noSubscribe = () => () => {};
const when = (t: number) => new Date(t).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The requests of this project, fetched on mount and again whenever agent work changes (the dining hall's own signal), and while any is still being made. */
export function useAgentRequests(projectId: string) {
  const [data, setData] = useState<RequestsData | null>(null);
  const last = useRef("");
  const refresh = useCallback(async () => {
    const d = (await fetch(`/api/projects/${projectId}/agent-requests`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as RequestsData | null;
    // only a poll that brings something new re-renders the course page (see useAgentTasks)
    const sig = d ? JSON.stringify(d) : "";
    if (d && sig !== last.current) {
      last.current = sig;
      setData(d);
    }
    return d;
  }, [projectId]);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await refresh();
      if (!stop) timer = setTimeout(tick, d?.open.some((r) => r.status === "running") ? 2000 : 15000);
    };
    void tick();
    const wake = () => void refresh();
    window.addEventListener("margin:agents", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("margin:agents", wake);
    };
  }, [refresh]);
  return { data, refresh };
}

/** Citations in a document, shown as plain page marks: the document is the agents' work, read here, not a place to jump from. */
function Cited({ text }: { text: string }) {
  return (
    <>
      {splitCitations(text).map((p, i) =>
        "cite" in p ? (
          <span key={i} className="ap-cite">
            {p.cite.raw}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Blocks({ blocks }: { blocks: AgentDocBlock[] }) {
  return (
    <div className="ap-doc">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h4 key={i}>{b.text}</h4>
        ) : b.type === "paragraph" ? (
          <p key={i}>
            <Cited text={b.text} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((x, k) => (
              <li key={k}>
                <Cited text={x} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/**
 * The side panel for the agents. "Leave a note" takes free typing or a suggestion; "Ready for you" holds what they made, to open, download
 * as PDF or Word, or delete. Opens from the right over the overview; Escape closes it.
 */
export function AgentPanel({ projectId, tab, onTab, onClose, data, refresh, suggestions }: { projectId: string; tab: "note" | "ready" | null; onTab: (t: "note" | "ready") => void; onClose: () => void; data: RequestsData | null; refresh: () => Promise<unknown>; suggestions: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const host = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ agent: AgentId } | null>(null);
  const [refused, setRefused] = useState<{ message: string; alternative: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{ title: string; agent: AgentId; blocks: AgentDocBlock[] } | null>(null);
  const [deleting, setDeleting] = useState<RequestItem | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (tab && !d.open) d.showModal();
    if (!tab && d.open) d.close();
  }, [tab, host]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setRefused(null);
    setSent(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agent-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const d = (await r.json().catch(() => null)) as { error?: string; refused?: { message: string; alternative: string }; started?: { agent: AgentId } } | null;
      if (!r.ok) setError(d?.error ?? "That didn't work. Try again.");
      else if (d?.refused) setRefused(d.refused);
      else if (d?.started) {
        setSent({ agent: d.started.agent });
        setText("");
        window.dispatchEvent(new Event("margin:agents")); // the dining hall shows them busy at once
        void refresh();
      }
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    }
    setBusy(false);
  };

  const open = async (r: RequestItem) => {
    const d = (await fetch(`/api/agent-requests/${r.id}`).then((x) => x.json()).catch(() => null)) as { title: string; agent: AgentId; blocks: AgentDocBlock[] } | null;
    if (d) setReading({ title: d.title, agent: d.agent, blocks: d.blocks });
  };
  const del = async () => {
    if (!deleting) return;
    setBusy(true);
    await fetch(`/api/agent-requests/${deleting.id}`, { method: "DELETE" }).catch(() => undefined);
    setBusy(false);
    setDeleting(null);
    setReading(null);
    window.dispatchEvent(new Event("margin:agents"));
    void refresh();
  };

  if (!host) return null;
  const ready = data?.ready ?? [];
  const working = (data?.open ?? []).filter((r) => r.status === "running");
  const notes = (data?.open ?? []).filter((r) => r.status === "declined" || r.status === "failed");
  return createPortal(
    <>
      <dialog
        ref={ref}
        className="ap m-paper"
        aria-labelledby={`${id}-t`}
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === ref.current) onClose();
        }}
      >
        {tab && (
          <div className="ap-in">
            <header className="ap-head">
              <h2 id={`${id}-t`} className="t-h3">
                The agents
              </h2>
              <Button variant="quiet" onClick={onClose}>
                Close
              </Button>
            </header>
            <Segmented label="The agents" idPrefix="ap-tab" panelId="ap-panel" value={tab} onChange={(v) => {
                setReading(null);
                onTab(v);
              }} options={[{ value: "note", label: "Leave a note" }, { value: "ready", label: `Ready for you (${ready.length})` }]} />

            <div id="ap-panel" role="tabpanel" className="ap-body">
              {tab === "note" && (
                <>
                  <p className="ap-lede">Tell the agents what you would like made. Margin sends it to the right one. They build it only from your own course files and your own writing, with citations. They won&rsquo;t write work you hand in for a grade.</p>
                  <label className="ap-label" htmlFor={`${id}-text`}>
                    Your note
                  </label>
                  <textarea
                    id={`${id}-text`}
                    className="ap-text"
                    rows={4}
                    maxLength={800}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (!busy && text.trim().length >= 4 && !(data !== null && data.remaining <= 0)) void send();
                      }
                    }}
                    aria-describedby={`${id}-hint`}
                    placeholder="For example: a one-page study guide for the first half of the course"
                  />
                  <p id={`${id}-hint`} className="ap-hint">Enter sends, Shift+Enter makes a new line.</p>
                  <div className="ap-suggest" role="group" aria-label="Suggestions">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="ap-chip" onClick={() => setText(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                  {refused && (
                    <div className="ap-notice" role="alert">
                      <p>{refused.message}</p>
                      <Button onClick={() => {
                          setText(refused.alternative);
                          setRefused(null);
                        }}>Make this instead</Button>
                    </div>
                  )}
                  {error && (
                    <p className="m-field-error" role="alert">
                      {error}
                    </p>
                  )}
                  {sent && (
                    <p className="ap-sent" role="status">
                      Sent to {NAME[sent.agent]}. You can watch them at their tables. When it is done it shows up in “While you were away” and in Ready for you.
                    </p>
                  )}
                  <div className="ap-actions">
                    <Button variant="accent" onClick={() => void send()} disabled={busy || text.trim().length < 4 || (data !== null && data.remaining <= 0)}>
                      {busy ? "Sending…" : "Send to the agents"}
                    </Button>
                    {data && (
                      <span className="ap-left">
                        {data.remaining} of {data.limit} notes left today
                      </span>
                    )}
                  </div>
                </>
              )}

              {tab === "ready" && !reading && (
                <>
                  {working.map((r) => (
                    <p key={r.id} className="ap-working" role="status">
                      {NAME[r.agent][0].toUpperCase() + NAME[r.agent].slice(1)} is working on “{r.text.slice(0, 70)}”…
                    </p>
                  ))}
                  {notes.map((r) => (
                    <div key={r.id} className="ap-notice">
                      <p>
                        <b>{r.status === "declined" ? "Not made." : "Couldn’t make it."}</b> {r.note}
                      </p>
                      <Button variant="quiet" onClick={() => setDeleting(r)} aria-label={`Delete the note “${r.text.slice(0, 40)}”`}>
                        Delete
                      </Button>
                    </div>
                  ))}
                  {!ready.length && !working.length && !notes.length && <p className="ap-lede">Nothing yet. Leave the agents a note and what they make waits here.</p>}
                  <ul className="ap-list">
                    {ready.map((r) => (
                      <li key={r.id}>
                        <p className="ap-title">{r.title}</p>
                        <p className="ap-meta">
                          Made by {NAME[r.agent]} · {when(r.createdAt)}
                        </p>
                        <div className="ap-row">
                          <Button onClick={() => void open(r)}>Open</Button>
                          <a className="m-btn" data-variant="secondary" href={`/api/agent-requests/${r.id}/download?format=pdf`} download aria-label={`Download ${r.title} as PDF`}>
                            PDF
                          </a>
                          <a className="m-btn" data-variant="secondary" href={`/api/agent-requests/${r.id}/download?format=docx`} download aria-label={`Download ${r.title} as Word`}>
                            Word
                          </a>
                          <Button variant="quiet" onClick={() => setDeleting(r)} aria-label={`Delete ${r.title}`}>
                            Delete
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {tab === "ready" && reading && (
                <div>
                  <Button variant="quiet" onClick={() => setReading(null)}>
                    Back to Ready for you
                  </Button>
                  <h3 className="ap-doc-title">{reading.title}</h3>
                  <p className="ap-meta">Made by {NAME[reading.agent]} from your own files and writing.</p>
                  <Blocks blocks={reading.blocks} />
                </div>
              )}
            </div>
          </div>
        )}
      </dialog>
      <ConfirmDialog open={deleting !== null} title="Delete this?" confirmLabel="Delete" busy={busy} onConfirm={() => void del()} onCancel={() => setDeleting(null)}>
        <p>This permanently deletes “{deleting?.title ?? deleting?.text.slice(0, 60)}”. It cannot be undone, and it does not give back a note for today.</p>
      </ConfirmDialog>
    </>,
    host,
  );
}
