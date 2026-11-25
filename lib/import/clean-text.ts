import type { Block, RawLine, RawPage } from "./types";

/**
 * Formatting only. Rebuilds paragraphs and lists from hard-wrapped lines, rejoins words hyphenated across a
 * line break, and lifts bare page numbers and repeated running headers out of the text. It never changes a word.
 */

const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;
const LIST_MARKER = /^\s*(?:[-*•·–]|\d{1,2}[.)]|[a-z][.)])\s+/;
const SENTENCE_END = /[.?!:"”’)]$/;

const headerKey = (t: string) => t.trim().toLowerCase().replace(/\d+/g, "#");
const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** Lines in the first or last two non-empty positions of a page, always leaving at least one line in the middle. */
function edgeIndexes(lines: RawLine[]): number[] {
  const filled = lines.map((l, i) => (l.text.trim() ? i : -1)).filter((i) => i >= 0);
  const k = Math.min(2, Math.floor((filled.length - 1) / 2));
  return k > 0 ? [...filled.slice(0, k), ...filled.slice(-k)] : [];
}

function liftRunning(pages: RawPage[]): { pages: RawPage[]; runningHeaders: string[] } {
  const counts = new Map<string, { count: number; sample: string }>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const i of edgeIndexes(p.lines)) {
      const text = p.lines[i].text;
      if (PAGE_NUMBER.test(text.trim())) continue;
      const key = headerKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key);
      counts.set(key, { count: (prev?.count ?? 0) + 1, sample: prev?.sample ?? squash(text) });
    }
  }
  const need = Math.max(3, Math.ceil(pages.length / 2));
  const running = new Map([...counts].filter(([, v]) => v.count >= need));
  const cleaned = pages.map((p) => {
    const drop = new Set(
      edgeIndexes(p.lines).filter((i) => PAGE_NUMBER.test(p.lines[i].text.trim()) || running.has(headerKey(p.lines[i].text))),
    );
    return { ...p, lines: p.lines.filter((_, i) => !drop.has(i)) };
  });
  return { pages: cleaned, runningHeaders: [...running.values()].map((v) => v.sample) };
}

function cleanPage(p: RawPage): Block[] {
  const blocks: Block[] = [];
  const longest = Math.max(0, ...p.lines.map((l) => l.text.trim().length));
  let cur: { kind: Block["kind"]; level?: number; items: string[] } | null = null;
  let prevLen = 0;

  const flush = () => {
    if (!cur) return;
    const text = cur.kind === "list" ? cur.items.map(squash).join("\n") : squash(cur.items.join(" "));
    blocks.push({ kind: cur.kind, text, page: p.page, ...(cur.kind === "heading" ? { level: cur.level } : {}) });
    cur = null;
  };

  const append = (line: string) => {
    if (!cur) return;
    const last = cur.items.length - 1;
    const prev = cur.items[last];
    if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(line)) cur.items[last] = prev.slice(0, -1) + line;
    else cur.items[last] = `${prev} ${line}`;
  };

  for (const raw of p.lines) {
    const line = raw.text.trim();
    if (!line) {
      flush();
      continue;
    }
    if (raw.heading) {
      if (cur?.kind === "heading" && cur.level === raw.heading) append(line);
      else {
        flush();
        cur = { kind: "heading", level: raw.heading, items: [line] };
      }
    } else if (LIST_MARKER.test(raw.text)) {
      if (cur?.kind !== "list") {
        flush();
        cur = { kind: "list", items: [] };
      }
      cur.items.push(line);
    } else if (cur?.kind === "list") {
      append(line);
    } else if (cur?.kind === "paragraph" && SENTENCE_END.test(cur.items[0].trimEnd().slice(-1) ? lastLine(cur.items) : "") && prevLen < longest * 0.8 && /^[A-Z"“‘'0-9]/.test(line)) {
      flush();
      cur = { kind: "paragraph", items: [line] };
    } else if (cur?.kind === "paragraph") {
      append(line);
    } else {
      flush();
      cur = { kind: "paragraph", items: [line] };
    }
    prevLen = line.length;
  }
  flush();
  return blocks;
}

const lastLine = (items: string[]) => items[items.length - 1].trimEnd();

export function cleanPages(pages: RawPage[]): { blocks: Block[]; runningHeaders: string[] } {
  const { pages: lifted, runningHeaders } = liftRunning(pages);
  return { blocks: lifted.flatMap(cleanPage), runningHeaders };
}
