/**
 * Explained is written as plain text so it can stream into the page as Claude writes it, section by section. The format is a small
 * Markdown subset:
 *
 *   # Summary
 *   Two or three sentences.
 *
 *   ## A sub-question of the big question?
 *   Paragraphs, separated by blank lines.
 *   - bullet items
 *   Table: a caption
 *   | column | column |
 *   | --- | --- |
 *   | cell | cell |
 *
 *   # So what
 *   Two to four sentences.
 *
 * `readExplained` reads any prefix of it (a draft while it streams) or all of it. Pure.
 */
import type { ExplainedOut, ExplainedSection, ExplainedSectionBlock } from "@/lib/ai/schemas";

export interface ExplainedDraft {
  summary: string;
  sections: ExplainedSection[];
  soWhat: string;
}

type Part = "none" | "summary" | "section" | "sowhat";

/** Bold, italics markers and stray heading marks are not part of Margin's prose. */
const tidy = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,;:!?]|$)/g, "$1$2").replace(/\s+/g, " ").trim();
/** While streaming, a citation still being written ("[Clogg.pdf, p.") is left off until it is complete. */
const dropOpenBracket = (t: string) => t.replace(/\[[^\]]*$/, "").trimEnd();
const cellsOf = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => tidy(c));
const isRule = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

/** Read Explained text into its parts. With `final` false the last line may be cut off mid-word: it is kept, minus an unfinished citation. */
export function readExplained(text: string, { final = true }: { final?: boolean } = {}): ExplainedDraft {
  const lines = text.replace(/\r/g, "").split("\n");
  if (!final && lines.length) lines[lines.length - 1] = dropOpenBracket(lines[lines.length - 1]);
  const out: ExplainedDraft = { summary: "", sections: [], soWhat: "" };
  let part: Part = "none";
  let para: string[] = [];
  let bullets: string[] = [];
  type Table = { caption: string; columns: string[]; rows: string[][] };
  let table: Table | null = null;
  let caption = "";
  const blocks = () => out.sections[out.sections.length - 1]?.blocks;
  const flush = () => {
    const text = tidy(para.join(" "));
    para = [];
    if (text) {
      if (part === "summary") out.summary = tidy(`${out.summary} ${text}`);
      else if (part === "sowhat") out.soWhat = tidy(`${out.soWhat} ${text}`);
      else if (part === "section") blocks()!.push({ type: "paragraph", text });
    }
    if (bullets.length) {
      if (part === "section") blocks()!.push({ type: "bullets", items: bullets });
      else if (part === "summary") out.summary = tidy(`${out.summary} ${bullets.join(" ")}`);
      else if (part === "sowhat") out.soWhat = tidy(`${out.soWhat} ${bullets.join(" ")}`);
      bullets = [];
    }
    if (table) {
      if (part === "section" && table.columns.length >= 2 && table.rows.length) {
        const width = table.columns.length;
        const rows = table.rows.map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill("")]));
        blocks()!.push({ type: "table", caption: table.caption || table.columns.join(" and "), columns: table.columns, rows, source: "" });
      }
      table = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    // a smaller heading inside a section ("### The patriarch") is part of the section: kept as a line of its text
    if (heading && heading[1].length >= 3 && part === "section" && !/^(summary|so what)\b/i.test(heading[2].trim())) {
      flush();
      para.push(heading[2].trim());
      flush();
      continue;
    }
    if (heading) {
      flush();
      const words = heading[2].trim();
      if (/^summary\b/i.test(words)) part = "summary";
      else if (/^so what\b/i.test(words)) part = "sowhat";
      else {
        part = "section";
        out.sections.push({ question: tidy(words), blocks: [] });
      }
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    if (/^table:\s*/i.test(line)) {
      flush();
      caption = tidy(line.replace(/^table:\s*/i, ""));
      continue;
    }
    if (line.startsWith("|")) {
      if (para.length || bullets.length) {
        const keep: Table | null = table;
        table = null;
        flush();
        table = keep;
      }
      if (isRule(line)) continue;
      if (!table) {
        table = { caption, columns: cellsOf(line), rows: [] };
        caption = "";
      } else table.rows.push(cellsOf(line));
      continue;
    }
    if (table) flush();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (para.length) {
        const keep = bullets;
        bullets = [];
        flush();
        bullets = keep;
      }
      bullets.push(tidy(bullet[1]));
      continue;
    }
    if (bullets.length) flush();
    para.push(line);
  }
  flush();
  out.sections = out.sections.filter((s) => s.question || s.blocks.length);
  return out;
}

/** True once the draft has the whole shape: a summary, sections that each have text, and the so what. */
export const isComplete = (d: ExplainedDraft): d is ExplainedOut => !!d.summary && d.sections.length > 0 && d.sections.every((s) => s.blocks.length > 0) && !!d.soWhat;

/** One block back in the text format, to send a section back to Claude. */
function blockText(b: ExplainedSectionBlock): string {
  if (b.type === "paragraph") return b.text;
  if (b.type === "bullets") return b.items.map((i) => `- ${i}`).join("\n");
  return [`Table: ${b.caption}`, `| ${b.columns.join(" | ")} |`, `| ${b.columns.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** A section in the text format: its heading and blocks. */
export const sectionText = (s: ExplainedSection) => [`## ${s.question}`, ...s.blocks.map(blockText)].join("\n\n");

/** A section Claude wrote again, read back: the first section in the text (its heading kept from the answer, or the old one). */
export function readSection(text: string, fallbackQuestion: string): ExplainedSection | null {
  const d = readExplained(/^\s*#/.test(text) ? text : `## ${fallbackQuestion}\n\n${text}`);
  const s = d.sections[0];
  return s && s.blocks.length ? { question: s.question || fallbackQuestion, blocks: s.blocks } : null;
}
