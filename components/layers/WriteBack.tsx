"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CitedText, type CiteHandler } from "@/components/ui/Citation";
import { Textarea } from "@/components/ui/Input";
import { readEvents } from "@/lib/ui/sse";
import { LayerMark } from "@/components/ui/LayerMark";
import { VERSION_WORD, type SaveChoice } from "@/lib/layers/loop";
import type { LayerState } from "@/lib/layers/progress";
import type { Thread, ThreadMessage } from "@/lib/layers/writeback";

type Busy = "idle" | "reviewing" | "explaining";
const FIX_WORD: Record<string, string> = { fact: "Fact", term: "Term", name: "Name", missing: "Missing", vague: "Unclear", grammar: "Grammar" };

/** A message arrives with a short fade and a few px of rise. History that was already there does not move. */
function Arrive({ fresh, className, kind, children }: { fresh: boolean; className: string; kind: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      data-kind={kind}
      initial={fresh ? { opacity: 0, y: reduced ? 0 : 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

const draftKey = (key: string) => `margin:draft:${key}`;
const readDraft = (key: string) => {
  try {
    return localStorage.getItem(draftKey(key)) ?? "";
  } catch {
    return "";
  }
};

/** The words that differ between a layer and a Part synthesis. Same loop, same pane. */
const COPY = {
  layer: {
    pane: "Write this layer back",
    head: "Write it back",
    log: "This layer's feedback",
    box: "Write this layer in your own words",
    hint: "Your words, not the layer's. Cmd+Enter submits.",
    yours: "Your write-back",
    wait: "Reading your write-back. This takes a moment.",
    empty: "Read the layer, then write it in your own words below. You will get specific fixes, your own version cleaned up, and one so what. Revise and resubmit as often as you like, then choose what goes to Note to Self.",
  },
  synthesis: {
    pane: "Write the synthesis",
    head: "Write the synthesis",
    log: "The synthesis feedback",
    box: "Write the synthesis in your own words",
    hint: "One piece that pulls the layers together. Cmd+Enter submits.",
    yours: "Your synthesis",
    wait: "Reading your synthesis. This takes a moment.",
    empty: "Pull this Part’s layers together in your own words: one piece, one argument, not a list. You will get the same fixes, your version cleaned up and a so what. Revise as often as you like, then choose what goes to Note to Self.",
  },
} as const;
export type WriteBackKind = keyof typeof COPY;

/**
 * The right pane of a layer or a Part synthesis: a large writing area, Submit and I don't get it, and the chatbot's saved history.
 * Each review shows Fixes, Your version cleaned up, So what and the verdict (for information), and ends with one question:
 * "Send to Note to Self?". Nothing here is locked.
 * `base` is the API for this target: /api/layers/[id] or /api/parts/[id]/synthesis.
 */
export function WriteBack({ base, draftId, kind = "layer", state, onCite }: { base: string; draftId: string; kind?: WriteBackKind; state: LayerState; onCite: CiteHandler }) {
  const copy = COPY[kind];
  const layerId = draftId;
  const router = useRouter();
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // localStorage doesn't exist on the server, so the remembered draft is read after hydration, not in the initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(readDraft(layerId));
    let gone = false;
    void fetch(`${base}/messages`)
      .then((r) => r.json())
      .then((d: { thread?: Thread }) => !gone && d.thread && setThread(d.thread))
      .catch(() => !gone && setError("Margin couldn't load this layer's history. Reload the page."));
    return () => {
      gone = true;
      abort.current?.abort();
    };
  }, [layerId, base]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [thread, live, busy]);

  const keep = (text: string) => {
    setDraft(text);
    try {
      localStorage.setItem(draftKey(layerId), text);
    } catch {
      /* the draft just isn't remembered */
    }
  };

  const received = (t: Thread) => {
    setFreshFrom(thread?.messages.length ?? 0);
    setThread(t);
    router.refresh(); // the progress marks in the layer list
  };

  const post = async (url: string, body?: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: abort.current?.signal });
    return r;
  };
  const problem = async (r: Response) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";

  /** "I don't get it": the explanation streams in as text; Stop ends it and what arrived is kept. */
  const dontGetIt = useCallback(
    async (confusion?: string) => {
      setBusy("explaining");
      setError(null);
      setLive("");
      abort.current = new AbortController();
      try {
        const r = await post(`${base}/dont-get-it`, { confusion });
        if (!r.ok || !r.body) {
          setError(await problem(r));
          return;
        }
        await readEvents(r, (d) => {
          if (d.error) setError(d.error);
          else if (d.type === "text" && d.delta) setLive((x) => x + d.delta);
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Margin lost the connection. Check that the app is still running, then try again.");
      } finally {
        abort.current = null;
        setBusy("idle");
        setLive("");
        const d = (await fetch(`${base}/messages`).then((x) => x.json()).catch(() => null)) as { thread?: Thread } | null;
        if (d?.thread) received(d.thread);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, thread],
  );

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy !== "idle") return;
    setError(null);
    setBusy("reviewing");
    abort.current = new AbortController();
    try {
      const r = await post(`${base}/submit`, { text });
      if (!r.ok) return setError(await problem(r));
      const d = (await r.json()) as { kind: "review" | "dont_get_it"; thread: Thread };
      if (d.kind === "dont_get_it") {
        keep("");
        setBusy("idle");
        return void dontGetIt();
      }
      // A review leaves the writing in the box: the next step is to revise it, or to send it on.
      received(d.thread);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      abort.current = null;
      setBusy((b) => (b === "reviewing" ? "idle" : b));
    }
  };

  /** The answer to "Send to Note to Self?". The reply stays where it is; only the question below it changes. */
  const save = async (writebackId: string | null, choice: SaveChoice) => {
    if (!writebackId || saving) return;
    setError(null);
    setSaving(writebackId);
    try {
      const r = await post(`${base}/save`, { writebackId, choice });
      if (!r.ok) return setError(await problem(r));
      const t = ((await r.json()) as { thread: Thread }).thread;
      setThread(t);
      router.refresh(); // the progress marks in the layer list
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      setSaving(null);
    }
  };

  const messages = thread?.messages ?? [];
  const fresh = (i: number) => freshFrom !== null && i >= freshFrom;
  const busyNow = busy !== "idle";

  return (
    <aside className="m-chat m-panel surface-desk" aria-label={copy.pane}>
      <header className="m-chat-head">
        <h2>{copy.head}</h2>
        <p>
          <LayerMark state={thread ? (thread.saved ? "saved" : "not_saved") : state} withLabel />
          {thread?.saved ? ` Sent as ${VERSION_WORD[thread.saved.version].toLowerCase()}.` : ""}
        </p>
      </header>

      <div className="m-chat-list" ref={list} role="log" aria-live="polite" aria-busy={busy !== "idle"} aria-label={copy.log}>
        {thread && messages.length === 0 && busy === "idle" && (
          <p className="t-ui m-write-empty">{copy.empty}</p>
        )}
        {messages.map((m, i) => (
          <Message key={m.id} m={m} fresh={fresh(i)} onCite={onCite} yours={copy.yours} saved={thread?.saved ?? null} onSave={(choice) => void save(m.writebackId, choice)} saving={saving === m.writebackId} />
        ))}
        {busy === "reviewing" && <p className="t-label m-write-wait" role="status">{copy.wait}</p>}
        {busy === "explaining" && (
          <div className="m-msg m-slip m-review" data-kind="tutor">
            <span className="m-msg-label">Explaining again, more simply</span>
            <p>{live ? <CitedText text={live} onCite={onCite} /> : "Finding a simpler way in…"}</p>
          </div>
        )}
      </div>

      <div className="m-chat-foot">
        {error && (
          <p className="m-field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <Textarea
          label={copy.box}
          placeholder={copy.box}
          rows={7}
          className="m-write-box"
          value={draft}
          onChange={(e) => keep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          hint={copy.hint}
        />
        <div className="m-act-row">
          <Button variant="accent" onClick={() => void submit()} disabled={!draft.trim() || busyNow}>
            Submit
          </Button>
          <Button onClick={() => void dontGetIt()} disabled={busyNow}>
            I don&rsquo;t get it
          </Button>
          {busy === "explaining" && (
            <Button variant="quiet" onClick={() => abort.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function Message({ m, fresh, onCite, yours, saved, onSave, saving }: { m: ThreadMessage; fresh: boolean; onCite: CiteHandler; yours: string; saved: Thread["saved"]; onSave: (c: SaveChoice) => void; saving: boolean }) {
  if (m.kind === "writeback") {
    return (
      <Arrive fresh={fresh} className="m-msg" kind="user">
        <span className="m-msg-label m-msg-label-on">{yours}</span>
        <p className="m-write-text">{m.content}</p>
      </Arrive>
    );
  }
  if (m.kind === "dont_get_it") {
    return (
      <Arrive fresh={fresh} className="m-msg" kind="action">
        <p>{m.role === "user" ? m.content : m.content}</p>
      </Arrive>
    );
  }
  if (m.kind === "reexplain") {
    return (
      <Arrive fresh={fresh} className="m-msg m-slip m-review" kind="tutor">
        <span className="m-msg-label">Explained again, more simply</span>
        <p className="m-write-text">
          <CitedText text={m.content} onCite={onCite} />
        </p>
      </Arrive>
    );
  }
  const r = m.review;
  if (!r) {
    return (
      <Arrive fresh={fresh} className="m-msg m-slip m-review" kind="tutor">
        <p>{m.content}</p>
      </Arrive>
    );
  }
  const approved = r.verdict === "approved";
  const sentThis = saved?.writebackId === m.writebackId ? saved.version : null;
  return (
    <Arrive fresh={fresh} className="m-msg m-slip m-review" kind="tutor">
      <p className="m-verdict" data-verdict={r.verdict}>
        <span aria-hidden="true">{approved ? "●" : "○"}</span> {approved ? "Approved" : "Not yet"}
        <span className="m-verdict-sub"> For your information; it decides nothing.</span>
      </p>
      {r.fixes.length > 0 && (
        <section>
          <h3>{approved ? "Small notes" : "Fixes"}</h3>
          <ul>
            {r.fixes.map((f, i) => (
              <li key={i}>
                <span className="m-fix-kind">{FIX_WORD[f.kind]}</span> <CitedText text={f.text} onCite={onCite} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Your version, cleaned up</h3>
        <p className="m-write-text m-cleaned">{r.cleanedUp}</p>
      </section>
      <section>
        <h3>So what</h3>
        <p>
          <CitedText text={r.soWhat} onCite={onCite} />
        </p>
      </section>
      <section className="m-save" aria-label="Send to Note to Self?">
        <h3>Send to Note to Self?</h3>
        <div className="m-save-row" role="group" aria-label="Send to Note to Self?">
          {([["own", "Yes, my own writing"], ["refined", "Yes, refined version"], ["no", "No"]] as const).map(([choice, label]) => (
            <Button key={choice} variant={m.saveChoice === choice ? "accent" : "secondary"} aria-pressed={m.saveChoice === choice} disabled={saving} onClick={() => onSave(choice)}>
              {label}
            </Button>
          ))}
        </div>
        <p className="m-save-status" role="status">
          {m.saveChoice === "no"
            ? "Not sent to Note to Self."
            : sentThis
              ? `In Note to Self: ${VERSION_WORD[sentThis].toLowerCase()}.`
              : m.saveChoice
                ? "Replaced by a newer version in Note to Self."
                : ""}
        </p>
      </section>
    </Arrive>
  );
}
