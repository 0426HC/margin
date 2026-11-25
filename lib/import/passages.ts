import { wordCount, type Section } from "./types";

export interface Passage {
  page: number;
  ordinal: number;
  text: string;
}

const TARGET = 180;
const SOFT_MAX = Math.round(TARGET * 1.25);

/**
 * Cuts a section's original text into search passages of about 180 words. A passage never spans two pages,
 * so a search hit always points at one page marker. Long paragraphs are cut at sentence ends.
 */
export function makePassages(section: Section): Passage[] {
  const units: { page: number; text: string }[] = [];
  for (const b of section.blocks) {
    if (wordCount(b.text) <= SOFT_MAX) units.push({ page: b.page, text: b.text });
    else for (const s of b.text.split(/(?<=[.?!]["”’)]?)\s+/)) units.push({ page: b.page, text: s });
  }

  const out: Passage[] = [];
  let buf: { page: number; parts: string[]; words: number } | null = null;
  const flush = () => {
    if (buf) out.push({ page: buf.page, ordinal: out.length, text: buf.parts.join(" ") });
    buf = null;
  };
  for (const u of units) {
    const n = wordCount(u.text);
    if (buf && (buf.page !== u.page || buf.words + n > SOFT_MAX)) flush();
    buf ??= { page: u.page, parts: [], words: 0 };
    buf.parts.push(u.text);
    buf.words += n;
    if (buf.words >= TARGET) flush();
  }
  flush();
  return out;
}
