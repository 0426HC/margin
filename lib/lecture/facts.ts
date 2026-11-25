import type { LectureFacts, LectureSlide, SlideRef } from "./types";

/**
 * Counting for the Lecture tab, by code and never by a model: which ideas get the most slides, which phrases repeat, which lines a slide
 * marks as important, which introduce an example. Pure: slides in, numbers and verbatim lines out.
 */

const STOP = new Set(
  "about above after again against also among because been before being between both cannot could does doing done during each either else even ever every from further have having here however into itself just like made make many more most much must never only other over same should since some such than that their them then there these they this those through under until upon very were what when where whether which while whom will with within without would your you the and for are but not can may our out all any one two its was has had who how why own off per via".split(" "),
);
const norm = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g)?.map((w) => w.replace(/['’]s$/, "")) ?? [];
const content = (w: string) => w.length >= 4 && !STOP.has(w);

const FLAG = /\b(important|key (?:point|idea|takeaway|term|concept)s?|remember|note that|make sure|on the (?:exam|test|midterm|final)|will be (?:on|tested|asked)|exam|crucial|essential|must (?:know|understand)|don'?t forget|take-?away|main point|central (?:point|idea|claim)|bottom line|big idea)\b/i;
const EXAMPLE = /\b(for example|for instance|e\.g\.|such as|imagine|suppose|consider|case of|example:|illustration|think of)\b|^\s*example\b/i;

const sentencesOf = (line: string) => line.split(/(?<=[.?!])\s+(?=[A-Z"“(])/).map((s) => s.trim()).filter(Boolean);
const key = (s: SlideRef) => `${s.file}\u0000${s.page}`;
const refs = (m: Map<string, SlideRef>): SlideRef[] => [...m.values()].sort((a, b) => (a.file === b.file ? a.page - b.page : a.file.localeCompare(b.file)));

export function lectureFacts(slides: LectureSlide[]): LectureFacts {
  const files = new Map<string, number>();
  for (const s of slides) files.set(s.file, (files.get(s.file) ?? 0) + 1);

  // ideas: a term counts once per slide, however often it is repeated on it
  const termSlides = new Map<string, Map<string, SlideRef>>();
  const termTotal = new Map<string, number>();
  for (const s of slides) {
    for (const w of wordsOf([s.heading ?? "", ...s.lines].join(" "))) {
      if (!content(w)) continue;
      const t = norm(w);
      (termSlides.get(t) ?? termSlides.set(t, new Map()).get(t)!).set(key(s), { file: s.file, page: s.page });
      termTotal.set(t, (termTotal.get(t) ?? 0) + 1);
    }
  }
  const terms = [...termSlides]
    .filter(([, m]) => m.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || (termTotal.get(b[0]) ?? 0) - (termTotal.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([term, m]) => ({ term, slides: refs(m) }));

  // phrases: runs of two to four words that appear on more than one slide (a run never crosses a line)
  const grams = new Map<string, Map<string, SlideRef>>();
  for (const s of slides) {
    for (const line of [s.heading ?? "", ...s.lines]) {
      const ws = wordsOf(line);
      for (let n = 4; n >= 2; n--) {
        for (let i = 0; i + n <= ws.length; i++) {
          const gram = ws.slice(i, i + n);
          if (!content(gram[0]) && STOP.has(gram[0])) continue;
          if (STOP.has(gram[gram.length - 1])) continue;
          if (gram.filter(content).length < 2) continue;
          const g = gram.join(" ");
          (grams.get(g) ?? grams.set(g, new Map()).get(g)!).set(key(s), { file: s.file, page: s.page });
        }
      }
    }
  }
  const multi = [...grams].filter(([, m]) => m.size >= 2).sort((a, b) => b[1].size - a[1].size || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]));
  const repeated: LectureFacts["repeated"] = [];
  for (const [phrase, m] of multi) {
    // a shorter phrase inside a longer one found on the same slides adds nothing
    if (repeated.some((r) => r.phrase.includes(phrase) && r.slides.length >= m.size)) continue;
    repeated.push({ phrase, slides: refs(m) });
    if (repeated.length === 5) break;
  }

  const longest = slides
    .map((s) => ({ file: s.file, page: s.page, title: s.heading ?? s.lines[0] ?? "", words: wordsOf([s.heading ?? "", ...s.lines].join(" ")).length }))
    .sort((a, b) => b.words - a.words || a.page - b.page)
    .slice(0, 3);

  const pick = (re: RegExp) => {
    const out: { file: string; page: number; text: string }[] = [];
    for (const s of slides) {
      for (const line of [s.heading ?? "", ...s.lines].filter(Boolean)) {
        // a whole short line, or the sentence that holds the cue
        const hit = line.length <= 220 && re.test(line) ? line.trim() : sentencesOf(line).find((x) => re.test(x));
        if (hit && !out.some((o) => o.file === s.file && o.page === s.page && o.text === hit)) out.push({ file: s.file, page: s.page, text: hit });
      }
    }
    return out.slice(0, 6);
  };

  return { files: [...files].map(([name, n]) => ({ name, slides: n })), slides: slides.length, terms, longest, repeated, flagged: pick(FLAG), examples: pick(EXAMPLE) };
}
