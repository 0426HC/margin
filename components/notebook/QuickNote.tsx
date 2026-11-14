"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type NoteTarget = { type: "layer" | "part"; id: string };
/** The notes area is never shorter than this, so an empty one is still a place to click. */
const MIN_HEIGHT = 96;

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Typing "->" gives an arrow. Returns the new text and where the caret goes (each "->" before it is one character shorter). */
export function arrowText(value: string, caret: number): { value: string; caret: number } {
  const before = value.slice(0, caret).replaceAll("->", "→");
  return { value: before + value.slice(caret).replaceAll("->", "→"), caret: before.length };
}

/**
 * Autosave for one piece of text in the notebook: saved shortly after typing stops, once more when the page is left or hidden.
 * `url` and `body` say where it goes; `skipEmpty` keeps an emptied text from being sent (a saved write-up can't be empty).
 * `value` is what is shown; `set` changes it and schedules the save.
 */
export function useAutosave(url: string, method: "PUT", bodyOf: (text: string) => unknown, initial: string, skipEmpty = false) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const dirty = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef(bodyOf);
  useEffect(() => {
    bodyRef.current = bodyOf;
  });

  const flush = useCallback(
    async (keepalive = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const text = dirty.current;
      if (text === null) return;
      dirty.current = null;
      if (skipEmpty && !text.trim()) return;
      setState("saving");
      try {
        const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(bodyRef.current(text)), keepalive });
        setState(r.ok ? "saved" : "error");
      } catch {
        setState("error");
      }
    },
    [url, method, skipEmpty],
  );

  const set = useCallback(
    (text: string) => {
      setValue(text);
      dirty.current = text;
      setState("idle");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  useEffect(() => {
    const hide = () => void flush(true);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      void flush(true);
    };
  }, [flush]);

  return { value, set, state };
}

/** Quick notes for one layer. */
export const useQuickNote = (projectId: string, target: NoteTarget, initial: string) =>
  useAutosave(`/api/projects/${projectId}/quick-notes`, "PUT", (text) => ({ targetType: target.type, targetId: target.id, text }), initial);

/** The saved write-up for one layer, edited in place. */
export const useWriteUp = (projectId: string, target: NoteTarget, initial: string) =>
  useAutosave(`/api/projects/${projectId}/write-up`, "PUT", (text) => ({ targetType: target.type, targetId: target.id, text }), initial, true);

/** Just text on the paper: no box, border or frame (like the Let's talk! Notepad). It grows with its text. Browser writing assistants are asked to stay out of it. */
export function NoteField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(MIN_HEIGHT, el.scrollHeight)}px`;
    if (caret.current !== null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [value, width]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <textarea
      ref={ref}
      className="nb-text"
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
      aria-label={label}
      rows={3}
      spellCheck
      value={value}
      onChange={(e) => {
        const next = arrowText(e.target.value, e.target.selectionStart);
        if (next.value !== e.target.value) caret.current = next.caret;
        onChange(next.value);
      }}
    />
  );
}
