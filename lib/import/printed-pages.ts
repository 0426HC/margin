import type { RawPage } from "./types";

/**
 * The printed page numbers of a PDF: a book chapter saved as a PDF starts at the book's own page (its first PDF page may be p. 7), and a
 * syllabus assigns pages by those printed numbers ("Clogg, pp. 7-30"). Code finds them where they sit: a number in the first or last lines
 * of a page (a bare page number, or one in a running header such as "8 A concise history of Greece"). Each such number is a guess at how
 * far the printed numbers run ahead of the PDF's own; the guess most pages agree on wins. Null when no steady numbering is found. Pure.
 */
export function printedOffset(pages: RawPage[]): number | null {
  const votes = new Map<number, number>();
  for (const p of pages) {
    const filled = p.lines.map((l) => l.text.trim()).filter(Boolean);
    const edge = [...filled.slice(0, 2), ...filled.slice(-2)];
    const seen = new Set<number>();
    for (const line of edge) {
      // a line long enough to be prose is not a header or footer
      if (line.split(/\s+/).length > 12) continue;
      for (const m of line.matchAll(/(?<![\d.,/-])(\d{1,4})(?![\d.,/-])/g)) {
        const n = Number(m[1]);
        if (n < 1 || n > 3000) continue;
        const offset = n - p.page;
        if (offset < 0 || seen.has(offset)) continue;
        seen.add(offset);
        votes.set(offset, (votes.get(offset) ?? 0) + 1);
      }
    }
  }
  const best = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (!best) return null;
  // a steady numbering: at least three pages agree (two in a very short file), and at least a quarter of the pages
  const need = Math.max(pages.length <= 4 ? 2 : 3, Math.ceil(pages.length / 4));
  return best[1] >= need ? best[0] : null;
}

/** "pp. 7–45": a file's pages in its printed numbers (or its own when it has none). */
export function printedSpan(pageCount: number, offset: number | null): { from: number; to: number } {
  const o = offset ?? 0;
  return { from: 1 + o, to: Math.max(1, pageCount) + o };
}
