/**
 * Checking a new Explained before it is kept, part by part, so only a part that fails is written again; and tidying any Explained before
 * it is shown. Pure.
 */
import { invalidCitations, splitCitations, stripInvalidCitations, type SentPassage } from "@/lib/ai/citations";
import type { ExplainedBlock, ExplainedOut, ExplainedSection, ExplainedSectionBlock } from "@/lib/ai/schemas";
import { nameKey } from "@/lib/brain/words";
import { explainedWords, sectionWords, words, type ExplainedBudget } from "./explained-length";

const citesIn = (t: string) => splitCitations(t).filter((p) => "cite" in p).length;
const bare = (t: string) =>
  splitCitations(t)
    .map((p) => ("text" in p ? p.text : ""))
    .join("")
    .replace(/[\s.,;:!?()–—-]+/g, "");
const citesOnly = (t: string) =>
  splitCitations(t)
    .flatMap((p) => ("cite" in p ? [p.cite.raw] : []))
    .join(" ");

/**
 * A paragraph or bullet that is nothing but a citation ("[Clogg.pdf, p. 4]") would show as an empty line with only "p. 4" in the margin.
 * Its citations join the text before it (or after it, when it comes first), and it goes.
 */
export function foldLoneCitations<B extends ExplainedBlock | ExplainedSectionBlock>(blocks: B[]): B[] {
  const out: B[] = [];
  let carry = "";
  const lastText = (): { get: () => string; set: (t: string) => void } | null => {
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i];
      if (b.type === "paragraph") return { get: () => b.text, set: (t) => (out[i] = { ...b, text: t }) };
      if (b.type === "bullets") return { get: () => b.items[b.items.length - 1], set: (t) => (out[i] = { ...b, items: [...b.items.slice(0, -1), t] }) };
      if (b.type === "heading") return null;
    }
    return null;
  };
  const attach = (cites: string) => {
    const t = lastText();
    if (t) t.set(`${t.get().trimEnd()} ${cites}`);
    else carry = `${carry} ${cites}`.trim();
  };
  for (const b of blocks) {
    if (b.type === "paragraph") {
      if (!bare(b.text)) {
        if (citesIn(b.text)) attach(citesOnly(b.text));
        continue;
      }
      out.push(carry ? { ...b, text: `${b.text.trimEnd()} ${carry}` } : b);
      carry = "";
    } else if (b.type === "bullets") {
      const items: string[] = [];
      for (const it of b.items) {
        if (bare(it)) items.push(it);
        else if (citesIn(it)) {
          if (items.length) items[items.length - 1] = `${items[items.length - 1].trimEnd()} ${citesOnly(it)}`;
          else attach(citesOnly(it));
        }
      }
      if (!items.length) continue;
      if (carry) {
        items[0] = `${items[0].trimEnd()} ${carry}`;
        carry = "";
      }
      out.push({ ...b, items });
    } else out.push(b);
  }
  return out;
}

/** A brain note on the layer's passages, with how many of them the brain found it in. */
export interface LayerNote {
  name: string;
  aliases: string[];
  kind: string;
  what: string;
  passages: number;
}

/**
 * A note the brain found in two or more of the layer's passages is one the readings discuss: the explanation must explain it. One found
 * in a single passage is named in passing; the prompt asks for a few words on it where it comes up, and the check doesn't hold it.
 */
export const mustExplain = (n: LayerNote) => n.passages >= 2;

/**
 * How many named things a layer's share of words can explain properly (what it is, an example, why it matters): about one per 45 words,
 * at least six. The brain lists far more for a long layer (60 or so for 10,000 words of reading); a week of about 4,000 words can't explain
 * them all, so the checklist holds the ones the readings discuss most, and the rest are asked for in a few words where they come up.
 */
export const conceptRoom = (target: number) => Math.max(6, Math.round(target / 45));

/** The named things the explanation must explain: those the readings discuss (two or more passages), most discussed first, as many as fit. */
export const requiredNotes = (notes: LayerNote[], target: number) =>
  notes
    .filter(mustExplain)
    .sort((a, b) => b.passages - a.passages)
    .slice(0, conceptRoom(target));

/** The text pieces of a section that can explain something: paragraphs, bullet items and table rows. */
const piecesOf = (s: ExplainedSection) => s.blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : b.rows.map((r) => r.join(" "))));

/** A piece explains a name when it names it, cites the reading and has room to say what it is and why it matters: a passing mention in a list doesn't. */
export const EXPLAIN_MIN_WORDS = 18;

/** The ways a note can be written in prose: its name, other names, the name without a bracket, a person's surname, a plural or singular. */
function formsOf(n: LayerNote): string[] {
  const names = [n.name, ...n.aliases, ...[n.name, ...n.aliases].map((x) => x.replace(/\s*\(.*?\)\s*/g, " "))];
  const out = new Set<string>();
  for (const name of names) {
    const k = nameKey(name);
    if (!k) continue;
    out.add(k);
    out.add(k.endsWith("s") ? k.slice(0, -1) : `${k}s`);
    const parts = k.split(" ");
    if (n.kind === "person" && parts.length > 1 && parts[parts.length - 1].length >= 4) out.add(parts[parts.length - 1]);
  }
  return [...out].filter((f) => f.length >= 3);
}

const LINKS = new Set(["the", "and", "of", "in", "into", "on", "to", "for", "from", "with", "by", "at", "its", "their", "a", "an", "as", "or", "under", "over", "between", "against"]);
/** A word's stem for loose matching: its first five letters ("expansion" and "expanded" meet at "expan"). */
const stem = (w: string) => w.slice(0, 5);
/** The words that carry a name ("Fall of Constantinople (1453)" → fall, const, 1453): no small linking words. */
const keyWords = (name: string) => [...new Set(nameKey(name).split(" ").filter((w) => w.length >= 3 && !LINKS.has(w)).map(stem))];

/**
 * A descriptive name (an event or idea named in three or more words, like "Ottoman entry into Europe and Balkan expansion") is seldom
 * written out whole in prose; it counts as named where most of its key words come together in one passage.
 */
function describedIn(key: string, n: LayerNote): boolean {
  const have = new Set(key.split(" ").map(stem));
  return [n.name, ...n.aliases].some((name) => {
    const words = keyWords(name);
    if (words.length < 3) return false;
    return words.filter((w) => have.has(w)).length >= Math.ceil(words.length * 0.6);
  });
}

const has = (key: string, form: string) => ` ${key} `.includes(` ${form} `);

/** Whether a note is explained somewhere in the sections (not only mentioned). */
export function isExplained(sections: ExplainedSection[], n: LayerNote): boolean {
  const forms = formsOf(n);
  return sections.some((s) =>
    piecesOf(s).some((p) => {
      if (citesIn(p) === 0 || words(p) < EXPLAIN_MIN_WORDS) return false;
      const key = nameKey(p);
      return forms.some((f) => has(key, f)) || describedIn(key, n);
    }),
  );
}

/** The notes the readings discuss that the sections don't explain (of those given: pass `requiredNotes` to hold the checklist to its room). */
export const unexplained = (sections: ExplainedSection[], notes: LayerNote[]) => notes.filter((n) => mustExplain(n) && !isExplained(sections, n));

/** What is wrong with one section on its own: citations to nothing, or nothing cited at all. Empty: it stands. */
export function sectionProblems(s: ExplainedSection, sent: SentPassage[]): string[] {
  const problems: string[] = [];
  const text = s.blocks.map((b) => (b.type === "paragraph" ? b.text : b.type === "bullets" ? b.items.join(" ") : `${b.source} ${b.rows.flat().join(" ")}`)).join(" ");
  const bad = [...new Set(invalidCitations(text, sent))];
  if (bad.length) problems.push(`It cites sources that are not in the passages: ${bad.slice(0, 8).join(", ")}. Cite only the files and pages given.`);
  if (!citesIn(text)) problems.push("It cites nothing. Every fact, name, date and number, and every claim about what a reading says, needs its [file, p. N].");
  return problems;
}

/**
 * When the explanation is too long or too short, the sections to write again and the words each should come to: the longest first when
 * it is too long, the shortest first when too short, until the change covers the gap. Empty when the length is fine.
 */
export function lengthFixes(out: ExplainedOut, length: ExplainedBudget): { index: number; words: number }[] {
  const total = explainedWords({ ...out, version: 2, question: "" });
  if (total >= length.min && total <= length.max) return [];
  const over = total > length.max;
  // back inside the limits, with a little room: never all the way to the target, so as few sections as possible are written again
  const gap = over ? total - length.max + Math.round(length.target * 0.05) : length.min - total + Math.round(length.target * 0.05);
  const sized = out.sections.map((s, index) => ({ index, n: sectionWords(s) })).sort((a, b) => (over ? b.n - a.n : a.n - b.n));
  const fixes: { index: number; words: number }[] = [];
  let covered = 0;
  for (const { index, n } of sized) {
    if (covered >= gap) break;
    // a section can give up to half of itself, or grow by up to its own length
    const change = Math.min(gap - covered, over ? Math.floor(n / 2) : Math.max(n, 80));
    if (change < 20) continue;
    fixes.push({ index, words: over ? n - change : n + change });
    covered += change;
  }
  return fixes;
}

/** Everything the check found, by part, so each part can be written again on its own. */
export interface ExplainedReport {
  /** Sections to write again, with what is wrong with each (and the words to aim for when length is the problem). */
  sections: { index: number; problems: string[]; words?: number }[];
  /** Named things the readings discuss that the sections don't explain yet: each is added to the section where it matters. */
  missing: LayerNote[];
}

/** Check a new Explained, part by part. Notes are the brain's; with none (its files not read yet) the concept check waits for them. */
export function checkExplained(out: ExplainedOut, ctx: { sent: SentPassage[]; notes: LayerNote[]; length: ExplainedBudget }): ExplainedReport {
  const bySection = new Map<number, { problems: string[]; words?: number }>();
  out.sections.forEach((s, i) => {
    const p = sectionProblems(s, ctx.sent);
    if (p.length) bySection.set(i, { problems: p });
  });
  const total = explainedWords({ ...out, version: 2, question: "" });
  for (const f of lengthFixes(out, ctx.length)) {
    const had = bySection.get(f.index) ?? { problems: [] };
    const note = total > ctx.length.max ? `The whole explanation is ${total} words and may be at most ${ctx.length.max}, so this section must come down to about ${f.words} words: keep every point and every named thing it explains, in fewer words.` : `The whole explanation is ${total} words and should be about ${ctx.length.target}, so this section should grow to about ${f.words} words: explain how and why in more depth.`;
    bySection.set(f.index, { problems: [...had.problems, note], words: f.words });
  }
  return { sections: [...bySection].map(([index, v]) => ({ index, ...v })).sort((a, b) => a.index - b.index), missing: unexplained(out.sections, requiredNotes(ctx.notes, ctx.length.target)) };
}

export const reportIsClean = (r: ExplainedReport) => !r.sections.length && !r.missing.length;

/** Citations that point at nothing are taken out (after the fixes), and lone citations folded in, so no empty line or made-up link is shown. */
export function cleanExplained(out: ExplainedOut, sent: SentPassage[]): ExplainedOut {
  const fix = (t: string) => stripInvalidCitations(t, sent).text;
  return {
    summary: out.summary,
    soWhat: fix(out.soWhat),
    sections: out.sections.map((s) => ({
      question: s.question,
      blocks: foldLoneCitations(s.blocks.map((b) => (b.type === "paragraph" ? { ...b, text: fix(b.text) } : b.type === "bullets" ? { ...b, items: b.items.map(fix) } : { ...b, source: fix(b.source), rows: b.rows.map((r) => r.map(fix)) }))),
    })),
  };
}
