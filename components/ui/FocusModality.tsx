"use client";

import { useEffect } from "react";

/**
 * Tells keyboard focus from a click or a tap, for the places to type (see globals.css): <html data-keyboard> after Tab, gone again on any
 * pointer press. Browsers treat every focus on a text field as :focus-visible, so CSS alone cannot tell them apart.
 */
export function FocusModality() {
  useEffect(() => {
    const root = document.documentElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Tab") root.setAttribute("data-keyboard", "");
    };
    const pointer = () => root.removeAttribute("data-keyboard");
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  return null;
}
