"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/**
 * A small "..." button that opens a short menu. Keyboard: Enter, Space or Arrow Down opens it and moves into it; the arrows move between
 * items; Escape closes it and returns to the button; Tab leaves it. The menu is drawn at the end of the page so a card's edges never clip it.
 * Nothing animates: it is used often and by keyboard.
 */
export function MoreMenu({ label, items, className = "" }: { label: string; items: MenuItem[]; className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties | null>(null);
  const open = at !== null;

  const close = useCallback((returnFocus: boolean) => {
    setAt(null);
    if (returnFocus) button.current?.focus();
  }, []);

  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  // move into the menu when it opens
  useEffect(() => {
    // without preventScroll, focusing an item near the window's edge scrolls the page a little, and a scroll closes the menu
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  // a click elsewhere, a scroll or a resize closes it
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const quit = () => close(false);
    // only a real scroll closes it: the browser nudges the page by a fraction of a pixel when the menu is added (scroll anchoring)
    const y0 = window.scrollY;
    const scrolled = (e: Event) => {
      if (e.target === document && Math.abs(window.scrollY - y0) < 4) return;
      close(false);
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", quit);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", quit);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open, close]);

  const move = (e: React.KeyboardEvent) => {
    const all = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") all[(i + 1) % all.length]?.focus();
    else if (e.key === "ArrowUp") all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === "Home") all[0]?.focus();
    else if (e.key === "End") all[all.length - 1]?.focus();
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`m-more ${className}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" fill="currentColor" />
          <circle cx="10" cy="10" r="1.6" fill="currentColor" />
          <circle cx="16" cy="10" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="m-menu" role="menu" aria-label={label} style={at} onKeyDown={move}>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true); // focus goes back to the button first, so a dialog opened by this item returns focus there when it closes
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
