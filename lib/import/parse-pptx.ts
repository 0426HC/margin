import JSZip from "jszip";
import { ImportError } from "./errors";
import type { Block, ParsedFile } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Slide files in presentation order (from presentation.xml), falling back to file-name order. */
async function slideOrder(zip: JSZip): Promise<string[]> {
  const all = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!pres || !rels) return all;
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, `ppt/${t.replace(/^\/?(ppt\/)?/, "")}`);
  }
  const ordered = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => target.get(m[1])).filter((n): n is string => !!n && !!zip.file(n));
  return ordered.length === all.length ? ordered : all;
}

function slideBlocks(xml: string, page: number): Block[] {
  const blocks: Block[] = [];
  for (const shape of xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
    const isTitle = /<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(shape[0]);
    for (const para of shape[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
      const text = decode(
        [...para[0].replace(/<a:br\s*\/>/g, "<a:t> </a:t>").matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join(""),
      ).replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (isTitle) {
        const last = blocks[blocks.length - 1];
        if (last?.kind === "heading") last.text += ` ${text}`;
        else blocks.push({ kind: "heading", level: 1, text, page });
      } else if (/<a:bu(?:Char|AutoNum)\b/.test(para[0])) {
        const last = blocks[blocks.length - 1];
        if (last?.kind === "list" && last.page === page) last.text += `\n${text}`;
        else blocks.push({ kind: "list", text, page });
      } else blocks.push({ kind: "paragraph", text, page });
    }
  }
  return blocks;
}

/** PowerPoint: one page per slide, in presentation order. Titles are headings. Speaker notes are not read. */
export async function parsePptx(bytes: Uint8Array): Promise<ParsedFile> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError("This PowerPoint file can't be read. Open it in PowerPoint, save it as .pptx, and re-add it.");
  }
  const files = await slideOrder(zip);
  const blocks: Block[] = [];
  for (const [i, name] of files.entries()) blocks.push(...slideBlocks(await zip.file(name)!.async("string"), i + 1));
  if (!blocks.length) throw new ImportError("No text found on these slides. If they are only images, Margin can't read them yet.");
  return { kind: "pptx", pageKind: "slide", pageCount: files.length, blocks, runningHeaders: [] };
}
