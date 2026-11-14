"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

/** The right pane: this section's chat. Buttons first, typing second. Controlled by its page. */
export function ChatPanel({
  title,
  children,
  pending,
  onAction,
  onSend,
}: {
  title: string;
  children: ReactNode;
  pending?: boolean;
  onAction: (key: "simpler" | "example" | "analogy" | "quiz" | "teach" | "connect") => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [children, pending]);

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    onSend(text);
  };

  return (
    <aside className="m-chat m-panel surface-desk" aria-label="Chat about this section">
      <header className="m-chat-head">
        <h2>{title}</h2>
        <p>Chat history is saved for this section only.</p>
      </header>
      <div className="m-chat-list" ref={list} role="log" aria-live="polite">
        {children}
        {pending && <p className="t-label" style={{ color: "var(--panel-muted)", margin: 0 }}>Reading this section…</p>}
      </div>
      <div className="m-chat-foot">
        <div className="m-act-row" role="group" aria-label="Explain differently">
          <span className="m-act-label">Explain differently</span>
          <Button onClick={() => onAction("simpler")}>Simpler</Button>
          <Button onClick={() => onAction("example")}>Example</Button>
          <Button onClick={() => onAction("analogy")}>Analogy</Button>
        </div>
        <div className="m-act-row">
          <Button onClick={() => onAction("quiz")}>Quiz me</Button>
          <Button variant="primary" onClick={() => onAction("teach")}>Teach it back</Button>
          <Button onClick={() => onAction("connect")}>Connect it</Button>
        </div>
        <form
          className="m-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            label="Ask anything about this section"
            hideLabel
            placeholder="Ask anything about this section"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button type="submit" variant="accent" disabled={!draft.trim() || pending}>
            Send
          </Button>
        </form>
        <p className="m-field-hint" style={{ margin: 0 }}>
          Start with &ldquo;note to self&rdquo; to save a note. Put a question in (parentheses) and it is answered for you.
        </p>
      </div>
    </aside>
  );
}
