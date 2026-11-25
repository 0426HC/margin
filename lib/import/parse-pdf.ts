import { cleanPages } from "./clean-text";
import { ImportError } from "./errors";
import { cleanAuthor } from "./office-author";
import { printedOffset } from "./printed-pages";
import { pdfTextQuality } from "./text-quality";
import type { ParsedFile, RawLine, RawPage } from "./types";

interface Item { str: string; transform: number[]; width: number; height: number }
interface Line { y: number; size: number; text: string; end: number }

/** Items on one page, grouped into lines by baseline. Space is added only where the PDF left a gap. */
function toLines(items: Item[]): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    const size = Math.abs(it.transform[3]) || it.height || 10;
    const x = it.transform[4];
    const y = it.transform[5];
    if (!it.str) continue;
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cur.y - y) < size * 0.5) {
      const gap = x - cur.end;
      const joinSpace = gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
      cur.text += (joinSpace ? " " : "") + it.str;
      cur.end = x + it.width;
      cur.size = Math.max(cur.size, size);
    } else lines.push({ y, size, text: it.str, end: x + it.width });
  }
  return lines;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export async function parsePdf(bytes: Uint8Array): Promise<ParsedFile> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 }).promise;
  } catch {
    throw new ImportError("This PDF can't be read. It may be damaged or password-protected. Re-save it as a plain PDF and add it again.");
  }

  const perPage: { page: number; lines: Line[] }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    perPage.push({ page: n, lines: toLines(content.items.filter((i): i is typeof i & Item => "str" in i) as Item[]) });
  }
  const chars = perPage.flatMap((p) => p.lines).reduce((n, l) => n + l.text.trim().length, 0);
  if (chars < 20) throw new ImportError("No text found in this PDF. It looks scanned, and Margin can't read scanned pages yet. Run it through OCR first.");

  // the body size is the most common size, by characters; larger short lines are headings
  const bySize = new Map<number, number>();
  for (const l of perPage.flatMap((p) => p.lines)) bySize.set(Math.round(l.size * 2) / 2, (bySize.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
  const headingSizes = [...new Set(perPage.flatMap((p) => p.lines).filter((l) => l.size >= body * 1.18 && l.text.trim().length <= 120).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);

  const pages: RawPage[] = perPage.map(({ page, lines }) => {
    const spacing = median(lines.slice(1).map((l, i) => lines[i].y - l.y).filter((d) => d > 0)) ?? body * 1.3;
    const out: RawLine[] = [];
    lines.forEach((l, i) => {
      if (i > 0 && lines[i - 1].y - l.y > spacing * 1.45) out.push({ text: "" });
      const rank = headingSizes.indexOf(Math.round(l.size * 2) / 2);
      const heading = l.size >= body * 1.18 && l.text.trim().length <= 120 && rank >= 0 ? Math.min(rank + 1, 3) : undefined;
      out.push({ text: l.text, size: l.size, heading });
    });
    return { page, lines: out };
  });

  const { blocks, runningHeaders } = cleanPages(pages);
  const textQuality = pdfTextQuality(blocks.map((b) => b.text).join(" "), doc.numPages);
  const info = (await doc.getMetadata().catch(() => null))?.info as { Author?: unknown } | undefined;
  const author = cleanAuthor(typeof info?.Author === "string" ? info.Author : null);
  return { kind: "pdf", pageKind: "page", pageCount: doc.numPages, blocks, runningHeaders, textQuality, author, printedOffset: printedOffset(pages) };
}
