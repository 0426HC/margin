"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseEntry, saveEntry, savedMessage, useNotes } from "./notes";

export type Command = { id: string; label: string; group: string; run: () => void };

/**
 * Cmd+K. Deliberately has no open or close animation: it is a keyboard action,
 * used constantly, so it should simply be there.
 */
export function Palette({
  commands,
  onAsk,
  onToast,
  scopeLabel,
}: {
  commands: Command[];
  onAsk: (text: string) => void;
  onToast: (msg: string) => void;
  scopeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const notes = useNotes();
  const listId = useId();

  const close = () => {
    setOpen(false);
    setShowNotes(false);
    setQuery("");
    setActive(0);
    returnTo.current?.focus?.();
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) returnTo.current = document.activeElement as HTMLElement;
        setOpen((o) => !o);
      }
    }
    function onOpenEvent(e: Event) {
      returnTo.current = document.activeElement as HTMLElement;
      setOpen(true);
      if ((e as CustomEvent<{ notes?: boolean }>).detail?.notes) setShowNotes(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("ws:palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ws:palette", onOpenEvent);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, showNotes]);

  const items = useMemo<Command[]>(() => {
    const q = query.trim();
    const typed: Command[] = [];
    if (q) {
      const { isNote, questions } = parseEntry(q);
      if (isNote || questions.length) {
        typed.push({
          id: "save",
          group: "From what you typed",
          label: isNote ? "Save to Notes" : "Save the question and answer it",
          run: () => onToast(savedMessage(saveEntry(q))),
        });
      } else {
        typed.push({ id: "ask", group: "From what you typed", label: `Ask: ${q}`, run: () => onAsk(q) });
      }
    }
    const notesCmd: Command = { id: "notes", group: "Go to", label: "Open Notes", run: () => setShowNotes(true) };
    const all = [...commands, notesCmd];
    const needle = q.toLowerCase();
    const matches = needle ? all.filter((c) => c.label.toLowerCase().includes(needle)) : all;
    // Notes and questions always win. Otherwise a command you named beats asking about it.
    const saving = typed[0]?.id === "save";
    return saving ? [...typed, ...matches] : [...matches, ...typed];
  }, [query, commands, onAsk, onToast]);

  if (!open) return null;

  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  function choose(c: Command | undefined) {
    if (!c) return;
    c.run();
    if (c.id === "notes") {
      setQuery("");
      setActive(0);
    } else {
      close();
    }
  }

  let lastGroup = "";

  return (
    <div className="pal-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-modal="true" aria-label={showNotes ? "Notes" : "Command bar"}>
        <div className="pal-input">
          <input
            ref={inputRef}
            value={query}
            placeholder={showNotes ? "Write a note, or a (question)" : "Ask anything, or type a command"}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={showNotes ? undefined : `${listId}-${safeActive}`}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (showNotes) setShowNotes(false);
                else close();
              } else if (showNotes) {
                if (e.key === "Enter" && query.trim()) {
                  const q = query.trim();
                  const parsed = parseEntry(q);
                  saveEntry(parsed.isNote || parsed.questions.length ? q : `note to self: ${q}`);
                  setQuery("");
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((safeActive + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((safeActive - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[safeActive]);
              }
            }}
          />
          <span className="pal-scope">{showNotes ? "Notes" : scopeLabel}</span>
        </div>

        {showNotes ? (
          <ul className="pal-notes" id={listId}>
            {notes.map((n) => (
              <li key={n.id} data-kind={n.kind}>
                <p className="pal-note-text">{n.kind === "question" ? `(${n.text})` : n.text}</p>
                {n.kind === "question" && (
                  <p className="pal-note-answer">{n.answer ?? "Answering…"}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="pal-list" role="listbox" id={listId} aria-label="Commands">
            {items.length === 0 && <p className="pal-empty">Nothing matches. Press Esc to go back to the page.</p>}
            {items.map((c, i) => {
              const head = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {head && <p className="pal-group">{head}</p>}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === safeActive}
                    className="pal-item"
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(c)}
                  >
                    {c.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="pal-foot">
          Start with &ldquo;note to self&rdquo; to save a note. Put a question in (parentheses) and it gets answered.
        </p>
      </div>
    </div>
  );
}
