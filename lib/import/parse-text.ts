import { cleanPages } from "./clean-text";
import { ImportError } from "./errors";
import { paginate } from "./paginate";
import type { FileKind, ParsedFile, RawLine } from "./types";

/** Plain text and Markdown. Markdown `#` headings become headings; everything else is kept as written. */
export function parseText(kind: "txt" | "md", bytes: Uint8Array): ParsedFile {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new ImportError("This file is empty. Remove it, or replace it with the real notes.");

  const lines: RawLine[] = text.split("\n").map((line) => {
    const h = kind === "md" ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    return h ? { text: h[2], heading: h[1].length } : { text: line };
  });
  const { blocks, runningHeaders } = cleanPages([{ page: 1, lines }]);
  const paged = paginate(blocks);
  return { kind: kind satisfies FileKind, pageKind: "virtual", pageCount: paged.pageCount, blocks: paged.blocks, runningHeaders };
}
