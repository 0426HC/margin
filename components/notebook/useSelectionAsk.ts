"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface Highlighted {
  text: string;
  /** Where to put the "Ask about this" chip: viewport coordinates just above the selection. */
  x: number;
  y: number;
}

const MIN = 3;
const clean = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * The passage selected inside `root`, in either column: ordinary page text, or the part of a quick-notes textarea that is selected.
 * It stays while focus moves to the chat (so typing a question with a passage selected still counts) and clears when the student
 * clicks or selects somewhere else on the page.
 */
export function useSelectionAsk(root: RefObject<HTMLElement | null>) {
  const [picked, setPicked] = useState<Highlighted | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const raf = useRef(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = (rect: { left: number; top: number; width: number }) => ({
      x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80),
      y: Math.max(rect.top - 10, 64),
    });
    const read = () => {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && el.contains(active)) {
        const text = clean(active.value.slice(active.selectionStart, active.selectionEnd));
        if (text.length >= MIN) {
          const r = active.getBoundingClientRect();
          const near = pointer.current.y >= r.top && pointer.current.y <= r.bottom;
          return setPicked({ text, ...place(near ? { left: pointer.current.x, top: pointer.current.y, width: 0 } : r) });
        }
        return setPicked(null);
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
        const text = clean(sel.toString());
        if (text.length >= MIN) return setPicked({ text, ...place(sel.getRangeAt(0).getBoundingClientRect()) });
      }
      // focus has gone to the chat box: keep what was selected until it is sent or replaced
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return;
      setPicked(null);
    };
    const soon = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(read);
    };
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      soon();
    };
    document.addEventListener("selectionchange", soon);
    el.addEventListener("pointerup", track);
    el.addEventListener("select", soon, true);
    el.addEventListener("keyup", soon);
    return () => {
      cancelAnimationFrame(raf.current);
      document.removeEventListener("selectionchange", soon);
      el.removeEventListener("pointerup", track);
      el.removeEventListener("select", soon, true);
      el.removeEventListener("keyup", soon);
    };
  }, [root]);

  const clear = useCallback(() => setPicked(null), []);
  return [picked, clear] as const;
}
