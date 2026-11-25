"use client";

import { useQuietMotion } from "@/lib/lockin/store";
import { splitCitations } from "@/lib/ai/citations";

/** The three tabs of a layer. */
export type LayerTab = "explained" | "lecture" | "source";
export const citeKey = (file: string, page: number) => `${file}\u0000${page}`;
const ease = [0.23, 1, 0.32, 1] as const;

/** The text of a block with its [file, p. N] citations lifted out, so they can sit in the margin instead. */
export function liftCitations(text: string) {
  const cites = new Map<string, { file: string; page: number }>();
  const body = splitCitations(text)
    .map((p) => {
      if ("text" in p) return p.text;
      cites.set(citeKey(p.cite.file, p.cite.page), { file: p.cite.file, page: p.cite.page });
      return "";
    })
    .join("")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { body, cites: [...cites.values()] };
}

/** Shared enter and exit for the tabs: opacity plus a few px of travel, nothing else. */
export function useSwap() {
  const reduced = useQuietMotion();
  return {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0.12 : 0.2, ease } },
    exit: { opacity: 0, y: 0, transition: { duration: reduced ? 0.08 : 0.1, ease: "easeOut" as const } },
  };
}
