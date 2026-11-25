import JSZip from "jszip";
import mammoth from "mammoth";
import { officeAuthor } from "./office-author";
import { ImportError } from "./errors";
import { paginate } from "./paginate";
import type { Block, ParsedFile } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const textOf = (html: string) =>
  decode(html.replace(/<a href="#footnote-ref-[^"]*">[\s\S]*?<\/a>/g, "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Word documents: heading styles, paragraphs and lists, via mammoth's HTML. Word has no fixed pages, so pages are virtual. */
export async function parseDocx(bytes: Uint8Array): Promise<ParsedFile> {
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value;
  } catch {
    throw new ImportError("This Word file can't be read. Open it in Word, save it again as .docx, and re-add it.");
  }
  const blocks: Omit<Block, "page">[] = [];
  for (const m of html.matchAll(/<(h[1-6]|p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const text = textOf(m[2]);
    if (!text) continue;
    if (m[1] === "li") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list") last.text += `\n${text}`;
      else blocks.push({ kind: "list", text });
    } else if (m[1] === "p") blocks.push({ kind: "paragraph", text });
    else blocks.push({ kind: "heading", level: Number(m[1][1]), text });
  }
  if (!blocks.length) throw new ImportError("No text found in this Word file.");
  const paged = paginate(blocks);
  const author = await JSZip.loadAsync(bytes).then(officeAuthor, () => null);
  return { kind: "docx", pageKind: "virtual", pageCount: paged.pageCount, blocks: paged.blocks, runningHeaders: [], author };
}
