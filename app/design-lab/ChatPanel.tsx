"use client";

import { motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useImperativeHandle, useRef, useState } from "react";
import { actionReplies, seedChat, type ChatItem } from "./data";
import { saveEntry } from "./notes";

type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, "id"> : never) : never;

const CITE = /\[([^\]]+?), p\. (\d+)\]/g;

function withCitations(text: string, onCite: (page: number) => void) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    const i = m.index ?? 0;
    out.push(text.slice(last, i));
    const page = Number(m[2]);
    out.push(
      <button
        type="button"
        className="chat-cite"
        key={i}
        onClick={() => onCite(page)}
        aria-label={`${m[1]}, page ${page}. Show in the original`}
      >
        {m[0]}
      </button>,
    );
    last = i + m[0].length;
  }
  out.push(text.slice(last));
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>);
}

const MOCK_REPLY =
  "In the app, this is answered from your files with page citations. The mockup only has canned replies, so try the buttons above.";

export type ChatHandle = { run: (key: keyof typeof actionReplies) => void; ask: (text: string) => void };

export function ChatPanel({
  title,
  enabled,
  onCite,
  handle,
}: {
  title: string;
  enabled: boolean;
  onCite: (page: number) => void;
  handle: React.Ref<ChatHandle>;
}) {
  const reduced = useReducedMotion();
  const [items, setItems] = useState<ChatItem[]>(enabled ? seedChat : []);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(100);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced || fresh.size === 0 ? "auto" : "smooth" });
  }, [items, pending, reduced, fresh.size]);

  function push(next: NewItem[], reply?: NewItem) {
    const stamped = next.map((n) => ({ ...n, id: `n${seq.current++}` }) as ChatItem);
    setItems((cur) => [...cur, ...stamped]);
    setFresh((f) => new Set([...f, ...stamped.map((s) => s.id)]));
    if (!reply) return;
    setPending(true);
    timer.current = window.setTimeout(() => {
      const r = { ...reply, id: `n${seq.current++}` } as ChatItem;
      setPending(false);
      setItems((cur) => [...cur, r]);
      setFresh((f) => new Set([...f, r.id]));
    }, 650);
  }

  function runAction(key: keyof typeof actionReplies) {
    if (pending || !enabled) return;
    const a = actionReplies[key];
    push([{ kind: "action", text: a.user }], { kind: "tutor", text: a.reply });
  }

  function send() {
    const text = draft.trim();
    if (!text || pending || !enabled) return;
    setDraft("");
    sendText(text);
  }

  function sendText(text: string) {
    if (/^\s*note to self/i.test(text)) {
      saveEntry(text);
      push([
        { kind: "user", text },
        { kind: "saved", text: "Saved to Notes." },
      ]);
    } else if (/\(([^()]+)\)/.test(text)) {
      saveEntry(text);
      push(
        [
          { kind: "user", text },
          { kind: "saved", text: "Question saved to Notes. The answer is added below it." },
        ],
        { kind: "tutor", label: "Answer to your question", text: MOCK_REPLY },
      );
    } else {
      push([{ kind: "user", text }], { kind: "tutor", text: MOCK_REPLY });
    }
  }

  useImperativeHandle(handle, () => ({ run: runAction, ask: sendText }));

  const arrive = (id: string) =>
    fresh.has(id)
      ? {
          initial: { opacity: 0, y: reduced ? 0 : 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: reduced ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] as const },
        }
      : { initial: false as const };

  return (
    <aside className="chat" aria-label="Chat about this section">
      <header className="chat-head">
        <h2>{title}</h2>
        <p>Chat history is saved for this section only.</p>
      </header>

      <div className="chat-list" ref={listRef} role="log" aria-live="polite">
        {items.length === 0 && (
          <p className="chat-empty">Nothing here yet. Use a button below, or ask a question about this section.</p>
        )}
        {items.map((m) => (
          <motion.div key={m.id} className={`msg ${m.kind}`} {...arrive(m.id)}>
            {m.kind === "tutor" && m.label && <span className="msg-label">{m.label}</span>}
            {m.kind === "tutor" ? <p>{withCitations(m.text, onCite)}</p> : <p>{m.text}</p>}
          </motion.div>
        ))}
        {pending && <p className="chat-pending">Reading this section…</p>}
      </div>

      <div className="chat-foot">
        <div className="actions">
          <div className="act-row" role="group" aria-label="Explain differently">
            <span className="act-label">Explain differently</span>
            <button type="button" className="act" onClick={() => runAction("simpler")}>Simpler</button>
            <button type="button" className="act" onClick={() => runAction("example")}>Example</button>
            <button type="button" className="act" onClick={() => runAction("analogy")}>Analogy</button>
          </div>
          <div className="act-row">
            <button type="button" className="act" onClick={() => runAction("quiz")}>Quiz me</button>
            <button type="button" className="act primary" onClick={() => runAction("teach")}>Teach it back</button>
            <button type="button" className="act" onClick={() => runAction("connect")}>Connect it</button>
          </div>
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="sr-only" htmlFor="composer">
            Ask anything about this section
          </label>
          <textarea
            id="composer"
            rows={2}
            value={draft}
            placeholder="Ask anything about this section"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="send" disabled={!draft.trim() || pending}>
            Send
          </button>
        </form>
        <p className="hint">
          Start with &ldquo;note to self&rdquo; to save a note. Put a question in (parentheses) and it is answered for you.
        </p>
      </div>
    </aside>
  );
}
