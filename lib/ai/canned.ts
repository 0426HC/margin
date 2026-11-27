import type { AiRequest } from "./engine";
import { ClaudeBusy, EngineError, UsageLimitReached } from "./errors";
import { FakeEngine } from "./fake-engine";
import { COURSE_TYPES, type FileType } from "@/lib/projects/file-kinds";
import { FROM_NOTES } from "@/lib/lecture/text";

/**
 * Failures on purpose, for tests of what the student sees: a layer whose title says "(fake: usage limit)", "(fake: busy)" or "(fake: error)"
 * fails that way when its Source or Explained is written; "(fake: hang)" never answers (see cannedEngine), so Margin's quiet limit is hit;
 * "(fake: slow)" streams its Explained over about ten seconds, so the page can be used while it is written (and lecture notes that say
 * "(fake: slow)" stream the Lecture tab's notes section over about twenty).
 */
/** The layer's title line of a Source or Explained prompt. */
const layerLine = (req: AiRequest) => (req.prompt.split("## Layer\n")[1] ?? "").split("\n")[0];

function cannedFailure(req: AiRequest) {
  if (!req.system.includes("You choose the source passages") && !req.system.includes('write the "Explained" tab')) return;
  const m = /\(fake: (usage limit|busy|error)\)/.exec(layerLine(req));
  if (!m) return;
  if (m[1] === "usage limit") throw new UsageLimitReached(new Date(Date.now() + 2 * 3600_000));
  if (m[1] === "busy") throw new ClaudeBusy();
  throw new EngineError("EngineFailed", "Claude stopped with an error: API Error: 500 (a made-up failure for testing).");
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };
/** A week number in a path, for the offline stand-in only ("Week 3", "Wk03", "Lecture 3", "Class Four"). The real import asks Claude. */
function fakeWeekIn(path: string): number | null {
  const m = /(?<![a-z])(?:week|wk|lecture|lec|class|session|module)[\s._-]*(\d{1,2}|[a-z]+)(?![a-z\d])/i.exec(path);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : (NUMBER_WORDS[m[1].toLowerCase()] ?? null);
  return n && n >= 1 && n <= 60 ? n : null;
}

/**
 * The offline stand-in for Claude reading a course folder (MARGIN_ENGINE=fake): weeks from "Week N (date): title" lines of the syllabus,
 * each file's week from a number in its path, its type from plain cues. Good enough for tests and the browser tests; never used for real.
 */
function cannedCourseMap(req: AiRequest) {
  const update = req.prompt.includes("Label the new files.");
  const files = [...req.prompt.matchAll(/^### (F\d+) \| (.+)\n(\S+)/gm)].map((m) => ({ id: m[1], path: m[2], format: m[3] }));
  const syllabus = req.prompt.split("== The syllabus")[1]?.split("\n== ")[0] ?? "";
  const weeks = new Map<number, { week: number; date: string | null; title: string; kind: "class" | "no-class" | "exam"; syllabus: string }>();
  if (update) {
    for (const m of req.prompt.matchAll(/^Week (\d+) \| ([^|]+) \| ([^|]+) \| (.*)$/gm)) weeks.set(Number(m[1]), { week: Number(m[1]), date: null, title: "", kind: "class", syllabus: "" });
  } else {
    // each "Week N (date): topic", up to the next "Week N", whether the lines arrive apart or run together
    for (const m of syllabus.matchAll(/(?<![a-z\d-])Week (\d{1,2})\b\s*(?:\(([^)]*)\))?\s*[:.\-–]?\s*([^\n]*?)(?=\s*[-*]?\s*(?<![a-z\d-])Week \d{1,2}\b|\n|$)/gi)) {
      const week = Number(m[1]);
      const line = m[3].trim();
      const title = line.split(/\.\s(?=[A-Z][a-z])|\s(?:Reading|Read):|\s(?:Final exam|Grading|Optional)\b/)[0].replace(/\.$/, "").trim().slice(0, 140);
      if (!weeks.has(week)) weeks.set(week, { week, date: m[2]?.trim() || null, title, kind: /reading week|no class|break|holiday/i.test(line) ? "no-class" : /midterm|final exam/i.test(line) ? "exam" : "class", syllabus: line.slice(0, 1200) });
    }
  }
  const labels = files.map((f) => {
    const name = f.path.split("/").pop() ?? f.path;
    const folders = f.path.split("/").slice(0, -1);
    const type: FileType = /syllab|outline/i.test(name)
      ? "syllabus"
      : folders.some((d) => /^(my )?notes$/i.test(d.trim())) || (/(?<![a-z])notes(?![a-z])/i.test(name) && !/notes (view|page)|lecture notes/i.test(name))
        ? "my-notes"
        : /(?<![a-z])(exam|midterm|quiz)/i.test(f.path)
          ? "exam"
          : /optional|extra readings?\//i.test(f.path)
            ? "optional"
            : /notes view|notes page|lecture notes|lecture #\d/i.test(name) || f.format === "PowerPoint" || /slides/i.test(name)
              ? "lecture"
              : "reading";
    const found = fakeWeekIn(f.path);
    // a week folder's own name after its number ("Week 3 - Checks" → "Checks"), as a person would read it when there is no syllabus
    const folder = folders.find((d) => fakeWeekIn(`${d}/`) === found) ?? "";
    const topic = folder.replace(/^.*?(?:week|wk|lecture|lec|class|session|module)[\s._-]*(?:\d{1,2}|[a-z]+)/i, "").replace(/^[\s:–—._-]+|[\s:–—._-]+$/g, "");
    return { file: f.id, type, found, topic, week: type === "syllabus" ? null : found };
  });
  if (!update) for (const l of labels) if (l.week !== null && !weeks.has(l.week)) weeks.set(l.week, { week: l.week, date: null, title: l.topic, kind: "class", syllabus: "" });
  const known = [...weeks.keys()].sort((a, b) => a - b);
  const latest = known[known.length - 1] ?? 1;
  if (!known.length && labels.some((l) => COURSE_TYPES.includes(l.type))) weeks.set(1, { week: 1, date: null, title: "", kind: "class", syllabus: "" });
  return {
    courseCode: update ? null : (/\b([A-Z]{2,4}) ?(\d{3})\b/.exec(req.prompt.split("Folder tree")[1] ?? "")?.slice(1, 3).join("") ?? null),
    weeks: update ? [] : [...weeks.values()].sort((a, b) => a.week - b.week),
    files: labels.map((l) => {
      const course = COURSE_TYPES.includes(l.type);
      const week = l.week !== null && (weeks.has(l.week) || update) ? l.week : course ? latest : null;
      const unsure = course && l.found === null;
      return { file: l.file, week, type: l.type, confidence: unsure ? "check" : "sure", reason: l.type === "syllabus" ? "The course syllabus." : unsure ? "No week in its name, so placed in the latest week; check this." : week ? `Its folder or name says week ${week}.` : "No week needed." };
    }),
    missingReadings: [],
    notInSyllabus: [],
  };
}

/**
 * The offline stand-in for the course brain reading a file: a note for the reading, and a concept note for the longest capitalised word of
 * each of the first passages (the made-up names tests use), each pointing at the passages that say it.
 */
function cannedBrainNotes(req: AiRequest) {
  const passages = [...req.prompt.matchAll(/^#(\d+) \[([^\]\n]+), p\. \d+\]\n([^\n]*)/gm)].map((m) => ({ n: Number(m[1]), file: m[2], text: m[3] }));
  const file = passages[0]?.file.replace(/\.[a-z0-9]+$/i, "") ?? "This file";
  const notes: { name: string; kind: string; aliases: string[]; what: string; why: string; passages: number[]; related: string[] }[] = [
    { name: file, kind: "reading", aliases: [], what: `The reading ${file}. It makes one argument in a few steps, in order.`, why: "It is the reading itself.", passages: passages.slice(0, 3).map((p) => p.n), related: [] },
  ];
  const seen = new Set<string>();
  for (const p of passages.slice(0, 12)) {
    const word = [...p.text.matchAll(/\b[A-Z][a-z]{5,}\b/g)].map((m) => m[0]).sort((a, b) => b.length - a.length)[0];
    if (!word || seen.has(word)) continue;
    seen.add(word);
    const at = passages.filter((q) => q.text.includes(word)).map((q) => q.n).slice(0, 12);
    notes.push({ name: word, kind: "concept", aliases: [], what: `${word} is a term this reading uses. It names one of the reading's main ideas.`, why: "The reading's argument turns on it.", passages: at, related: [] });
  }
  return { notes };
}

/** The offline stand-in for picking the brain's notes for a question: the notes whose name the question uses, else the first three. */
function cannedNotePick(req: AiRequest) {
  const question = (req.prompt.split("## The question\n")[1] ?? "").toLowerCase();
  const lines = [...req.prompt.matchAll(/^(N\d+) \| ([^|]+) \|/gm)].map((m) => ({ id: m[1], name: m[2].trim().toLowerCase() }));
  const named = lines.filter((l) => question.includes(l.name));
  return { notes: (named.length ? named : lines.slice(0, 3)).slice(0, 12).map((l) => l.id) };
}

/** Schema-valid answers for the layer flow, built from what the prompt contains. Used by MARGIN_ENGINE=fake, so tests and e2e run offline. */
export function cannedJson(req: AiRequest): unknown {
  cannedFailure(req);
  if (req.system.includes("find the SYLLABUS")) return { syllabus: [...req.prompt.matchAll(/^(F\d+) \| ([^|]+) \|/gm)].filter((m) => /syllab|outline/i.test(m[2].split("/").pop() ?? "")).map((m) => m[1]).slice(0, 3) };
  if (req.system.includes("You organise a university student's course folder")) return cannedCourseMap(req);
  if (req.system.includes("You are a professor preparing to teach a university course")) return cannedBrainNotes(req);
  if (req.system.includes("Below is the index of your notes on it")) return cannedNotePick(req);
  if (req.system.includes("Some files are saved in more than one week folder")) return { files: [...req.prompt.matchAll(/^### (F\d+) \|/gm)].map((m) => ({ file: m[1], pages: [] })) };
  if (req.system.includes("You check the notes a study app keeps")) return { notes: [] };
  if (req.system.includes("You are a sharp teaching assistant")) return { weeks: null, breaks: null, missingReadings: null, files: [], notes: [] };
  if (req.system.includes("CHAIN OF IDEAS")) {
    // One layer per file of the week (up to six, so code's merge to five can be seen), each file's passages in one range.
    const lines = req.prompt.split("\n");
    const groups: { file: string; from: number; to: number }[] = [];
    let file = "";
    for (const l of lines) {
      const head = /^== (.+?) · /.exec(l);
      if (head) file = head[1];
      const m = /^#(\d+) \|/.exec(l);
      if (!m) continue;
      const n = Number(m[1]);
      const g = groups[groups.length - 1];
      if (g && g.file === file && g.to === n - 1) g.to = n;
      else if (g && g.file === file) groups.push({ file, from: n, to: n });
      else groups.push({ file, from: n, to: n });
    }
    const merged: typeof groups = [];
    for (const g of groups) {
      const same = merged.find((x) => x.file === g.file);
      if (same && same.to === g.from - 1) same.to = g.to;
      else merged.push({ ...g });
    }
    const layers = merged.slice(0, 6).map((g, i) => {
      const name = g.file.replace(/\.[a-z0-9]+$/i, "");
      return { title: `The ideas of ${name}`.slice(0, 80), bigQuestion: `What does ${name} teach this week?`.slice(0, 218), buildsOn: i === 0 ? "" : "Builds on the idea before it.", ranges: [{ from: g.from, to: g.to }] };
    });
    // anything past the sixth file joins the last layer
    if (merged.length > 6) layers[5].ranges.push(...merged.slice(6).map((g) => ({ from: g.from, to: g.to })));
    // a week that needs two layers and has one file: its two halves
    const only = layers.length === 1 ? layers[0].ranges[0] : null;
    if (only && req.system.includes("- 2 to 5 layers") && only.to > only.from) {
      const mid = Math.floor((only.from + only.to) / 2);
      layers.push({ title: "Where the reading goes next", bigQuestion: `How does ${layers[0].title.replace(/^The ideas of /, "")} build its case?`.slice(0, 218), buildsOn: "Builds on the idea before it.", ranges: [{ from: mid + 1, to: only.to }] });
      only.to = mid;
    }
    return { layers };
  }
  if (req.system.includes("You place NEW course material")) {
    // Passages of a lecture or reading join the layer of the same name when there is one; a file named "new topic" starts a new layer.
    const layers = [...req.prompt.matchAll(/^L(\d+) \| [^|]*\| ([^|]*)\|/gm)].map((m) => ({ n: Number(m[1]), weeks: m[2] }));
    const ps = [...req.prompt.matchAll(/^#(\d+) \| [^|]*\| ([^|]*)\| ([^|]*?) p\. \d+ \|/gm)].map((m) => ({ n: Number(m[1]), week: m[2].trim(), file: m[3].trim() }));
    const groups: { layer: number; title: string; bigQuestion: string; buildsOn: string; ranges: { from: number; to: number }[] }[] = [];
    for (const p of ps) {
      const topic = /new topic/i.test(p.file);
      // a week no layer covers yet, later than all of them, is a new topic; otherwise the layer of that week, or the first
      const weekNo = Number(p.week.replace("Week ", "")) || 0;
      const latest = Math.max(0, ...layers.flatMap((l) => (l.weeks.match(/\d+/g) ?? []).map(Number)));
      const target = topic || (weekNo > latest && latest > 0) ? 0 : (layers.find((l) => new RegExp(`\\b${p.week.replace("Week ", "")}\\b`).test(l.weeks))?.n ?? layers[0]?.n ?? 0);
      const last = groups[groups.length - 1];
      if (last && last.layer === target && last.ranges[last.ranges.length - 1].to === p.n - 1 && (target !== 0 || last.title === p.file.replace(/\.[a-z0-9]+$/i, "").slice(0, 70))) last.ranges[last.ranges.length - 1].to = p.n;
      else groups.push({ layer: target, title: target === 0 ? p.file.replace(/\.[a-z0-9]+$/i, "").slice(0, 70) : "", bigQuestion: target === 0 ? `What does ${p.file.replace(/\.[a-z0-9]+$/i, "")} add to the course?` : "", buildsOn: target === 0 ? "Builds on the layers before it." : "", ranges: [{ from: p.n, to: p.n }] });
    }
    return { placements: groups.length ? groups : [{ layer: 0, title: "New material", bigQuestion: "What does the new material add?", buildsOn: "", ranges: [{ from: 1, to: 1 }] }] };
  }
  if (req.system.includes("You read an exam instruction sheet")) {
    const sheet = req.prompt.split("## The sheet\n")[1] ?? "";
    const minutes = Number(/(\d+)\s*(?:minutes|mins)/i.exec(sheet)?.[1]) || null;
    const kinds: [RegExp, string][] = [[/multiple[- ]choice/i, "multiple_choice"], [/short[- ]answer/i, "short_answer"], [/essay/i, "essay"], [/problem/i, "problem"]];
    const sections = kinds.filter(([re]) => re.test(sheet)).map(([, format], i) => ({ name: `Section ${"ABCD"[i]}`, format, count: format === "multiple_choice" ? 3 : format === "essay" ? 1 : 2, marksEach: format === "multiple_choice" ? 2 : format === "essay" ? 10 : 5, instructions: "" }));
    const range = /weeks?\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i.exec(sheet);
    const weeks = range ? Array.from({ length: Math.max(0, Number(range[2]) - Number(range[1]) + 1) }, (_, i) => Number(range[1]) + i) : [];
    const title = /final/i.test(sheet.split("\n")[0]) ? "Final exam" : /mid-?term/i.test(sheet.split("\n")[0]) ? "Midterm exam" : "Exam";
    return { title, date: /date:\s*([^.\n]+)/i.exec(sheet)?.[1]?.trim() ?? null, lengthMinutes: minutes, totalMarks: null, sections: sections.length ? sections : [{ name: "Section A", format: "short_answer", count: 3, marksEach: 5, instructions: "" }], weeks, topics: [], markingGuide: /marking guide:\s*([^\n]+)/i.exec(sheet)?.[1]?.trim() ?? "", terms: [], sampleQuestions: [] };
  }
  if (req.system.includes("You update the details of a student's exam")) {
    // the fake reads only the obvious: "three essay choices" / "choice of three" changes "choice of two questions" wherever it is written,
    // and "N minutes" or "N hours" changes the length
    const now = JSON.parse(req.prompt.split("## The details now\n")[1]?.split("\n\n## ")[0]?.split("\n\nReturn the updated details.")[0] ?? "{}");
    const heard = `${req.prompt.split("## What the student heard\n")[1] ?? ""}\n${req.prompt.split("## The updated sheet\n")[1] ?? ""}`;
    const n = /\b(two|three|four|five|2|3|4|5)\s+(?:essay\s+)?(?:choices|questions to choose from)|choice of (two|three|four|five|2|3|4|5)/i.exec(heard);
    const word = (n?.[1] ?? n?.[2])?.toLowerCase();
    const named = ({ 2: "two", 3: "three", 4: "four", 5: "five" } as Record<string, string>)[word ?? ""] ?? word;
    const sections = (now.sections ?? []).map((x: { instructions: string }) => (named ? { ...x, instructions: x.instructions.replace(/choice of \w+ questions/i, `choice of ${named} questions`) } : x));
    const hours = Number(/(\d+)\s*hours?/i.exec(heard)?.[1]) || null;
    const minutes = Number(/(\d+)\s*minutes/i.exec(heard)?.[1]) || (hours ? hours * 60 : null);
    return { ...now, sections, lengthMinutes: minutes ?? now.lengthMinutes };
  }
  if (req.system.includes("You write a practice exam")) {
    const plan = [...req.prompt.matchAll(/^(\d+) \| ([^|]+) \| (\d+) questions? \| [\d.]+ marks? each \|/gm)].map((m) => ({ section: Number(m[1]), format: m[2].trim(), count: Number(m[3]) }));
    const body = req.prompt.split("## Sources\n")[1] ?? "";
    const srcs = [...body.matchAll(/^\[([^\]\n]+), p\. (\d+)\]\n([^\n]*)/gm)].map((m) => ({ file: m[1], page: Number(m[2]), text: m[3] }));
    const avoided = (req.prompt.split("## Questions to avoid repeating\n")[1]?.split("\n\n")[0] ?? "").split("\n").filter(Boolean).length;
    const kindOf = (f: string) => (/past|practice/i.test(f) ? "past" : /exam|midterm|final/i.test(f) ? "sheet" : /slides|lecture/i.test(f) ? "lecture" : "reading");
    const labelOf = (k: string) => (k === "lecture" ? "the lecture slides" : k === "sheet" ? "your exam sheet" : k === "past" ? "a past exam" : "your course reading");
    const questions: unknown[] = [];
    let k = avoided * 3;
    for (const row of plan) {
      for (let i = 0; i < row.count; i++, k++) {
        const s = srcs[k % Math.max(1, srcs.length)] ?? { file: "x", page: 1, text: "the course" };
        const gist = s.text.split(/\s+/).slice(0, 7).join(" ");
        const mc = /multiple/i.test(row.format);
        questions.push({
          section: row.section,
          prompt: `${mc ? "Which statement fits" : /essay/i.test(row.format) ? "Discuss" : "Explain"} the passage that begins “${gist}”${avoided ? ` (from another angle, v${avoided})` : ""}?`,
          ...(mc ? { options: ["It is the passage's main claim.", "It contradicts the passage.", "It is unrelated to the passage.", "It is only an example."], correct: 0 } : {}),
          keyPoints: [`States what the passage says about “${gist}”.`],
          builtFrom: [{ kind: kindOf(s.file), label: labelOf(kindOf(s.file)), cite: `[${s.file}, p. ${s.page}]` }],
        });
      }
    }
    return { questions };
  }
  if (req.system.includes("You are the Examiner")) {
    const cite = req.prompt.split("## Sources\n")[1]?.match(/\[[^\]\n]+, p\. \d+\]/)?.[0] ?? "";
    const results = [...req.prompt.matchAll(/^### (\S+) \(([\d.]+) marks\)\n[^\n]*\nKey points: [^\n]*\nStudent's answer: ([^\n]*)/gm)].map((m) => {
      const marks = Number(m[2]);
      const good = m[3].trim().length > 40;
      return { id: m[1], marksAwarded: good ? Math.round((marks / 2) * 2) / 2 : 0, strengths: good ? "You wrote something substantial." : "", fixes: [`Cover the key point the passage makes. ${cite}`.trim()] };
    });
    return { results };
  }
  if (req.system.includes("The student left you a note asking for a document")) {
    const note = req.prompt.split("## The student's note\n")[1]?.split("\n\n")[0] ?? "";
    const cites = [...(req.prompt.split(/## Passages[^\n]*\n/)[1] ?? "").matchAll(/^\[([^\]\n]+), p\. (\d+)\]/gm)].map((m) => `[${m[1]}, p. ${m[2]}]`);
    if (/graded|for marks|hand in|submit/i.test(note)) return { declined: { message: "I can't write work that you hand in for a grade.", alternative: "I can make an essay plan checklist from your course files instead." }, title: "Not written", blocks: [] };
    const c = cites[0] ?? "";
    return { declined: null, title: `Made for you: ${note.slice(0, 60)}`, blocks: [{ type: "heading", text: "What your files say" }, { type: "bullets", items: [`The main point, taken from your files. ${c}`, `A second point, from the same material. ${cites[1] ?? c}`] }, { type: "paragraph", text: `This was built only from your course files and your own writing. ${c}` }] };
  }
  if (req.system.includes("You choose the source passages")) {
    const ns = [...req.prompt.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
    return { passages: ns.slice(0, 3) };
  }
  if (req.system.includes("You are the Librarian")) {
    // Two topics from the first four passages, so grouping and de-duplication can be seen offline.
    const ns = [...req.prompt.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
    const topics = [];
    if (ns.length) topics.push({ topic: "Main idea", passages: ns.slice(0, 2) });
    if (ns.length > 2) topics.push({ topic: "Supporting detail", passages: ns.slice(2, 4) });
    return { topics };
  }
  if (req.system.includes("Some named things in its readings are not yet explained")) {
    const missing = [...(req.prompt.split("## Not yet explained")[1]?.split("\n## ")[0] ?? "").matchAll(/^- (.+?)(?: \(also: [^)]*\))? \[[a-z]+\]:/gm)].map((m) => m[1]);
    const cite = passageCites(req)[0] ?? "";
    return { additions: missing.map((name) => ({ name, section: 1, text: `${name} matters here because the reading uses it to explain how the answer works, and the passage shows it at work in a case you can check. ${cite}`.trim() })) };
  }
  if (req.system.includes("You review a student's write-back")) {
    // First attempt: one fix. A revision (the prompt carries their earlier attempt) is approved.
    const writing = req.prompt.split(/## The student's (?:write-back|synthesis)\n/)[1]?.trim() ?? "";
    const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0] ?? "";
    const revised = req.prompt.includes("## Their earlier attempt");
    return {
      fixes: revised ? [] : [{ kind: "missing", text: `Say which term the passage defines first, and in the passage's own words. ${cite}`.trim() }],
      cleanedUp: writing || "Nothing was written.",
      soWhat: req.system.includes("synthesis of a whole week") ? "Together these layers make one argument about the week." : "This layer is one step in the course's larger argument.",
      verdict: revised ? "approved" : "needs_work",
    };
  }
  throw new EngineError("FakeEngineEmpty", "The fake engine has no canned answer for this call.");
}

/** The citations of the passages a prompt sent, in order. */
const passageCites = (req: AiRequest) => [...new Set([...(req.prompt.split("## Passages\n")[1] ?? "").matchAll(/^\[[^\]\n]+, p\. \d+\]/gm)].map((m) => m[0]))];

/**
 * The Explained tab as streamed text: three sections near the length it asks for, each named thing in the first list explained in its own
 * cited sentence. Layers titled "(fake: missing)" leave the named things out, so the check that adds them can be seen.
 */
function cannedExplained(req: AiRequest): string {
  const cites = passageCites(req);
  const cite = (i: number) => cites[i % Math.max(1, cites.length)] ?? "";
  const listed = [...(req.prompt.split("## Named in these passages: explain every one")[1]?.split("\n## ")[0] ?? "").matchAll(/^- (.+?)(?: \(also: [^)]*\))? \[[a-z]+\]:/gm)].map((m) => m[1]);
  const named = /\(fake: missing\)/.test(layerLine(req)) ? [] : listed;
  const target = Number(/run to about (\d+) words/.exec(req.system)?.[1] ?? 600);
  const filler = (n: number) => Array.from({ length: n }, (_, k) => `This step explains how and why the idea works, building on the one before it ${k + 1}.`).join(" ");
  const per = Math.max(2, Math.round((target - 120 - named.length * 30) / 3 / 16));
  const sections = [1, 2, 3].map((n) => {
    const own = named.filter((_, k) => k % 3 === n - 1).map((name, k) => `${name} is one of the layer's named ideas: the reading shows it at work in a case the student can check, and the answer depends on it. ${cite(k + n)}`);
    return [`## What is step ${n} of the answer, and why does it matter?`, `${filler(per)} ${cite(n)}`, ...own].join("\n\n");
  });
  return ["# Summary", "This layer asks one question and answers it in plain words. It starts from the basics and builds up to the course's own terms.", ...sections, "# So what", "This layer connects to the week's question and to the course's larger argument."].join("\n\n");
}

/** The passages of a prompt section, as [file, p. N] with their text. */
function promptPassages(body: string): { cite: string; file: string; text: string }[] {
  return [...body.matchAll(/^\[([^\]\n]+), p\. (\d+)\]\n([^\n]*)/gm)].map((m) => ({ cite: `[${m[1]}, p. ${m[2]}]`, file: m[1], text: m[3] }));
}
const sectionOf = (prompt: string, title: string) => (prompt.split(`## ${title}\n`)[1] ?? "").split("\n\n## ")[0];
const longWords = (t: string) => new Set(t.toLowerCase().match(/[a-z]{7,}/g) ?? []);

/**
 * "From your lecture notes": each note line expanded from the first passage that shares a word with it, cited; a line nothing in the files
 * is about is kept as written and marked "(from your notes)". Only what the student wrote, nothing added.
 */
function cannedLectureNotes(req: AiRequest): string {
  const notes = sectionOf(req.prompt, "The student's lecture notes, as written").split("\n").map((l) => l.trim()).filter(Boolean);
  const passages = promptPassages(sectionOf(req.prompt, "Passages from this week's readings and lecture material about these notes"));
  const out = ["### What the lecture covered"];
  for (const line of notes) {
    if (line.startsWith("# ")) {
      out.push(`### ${line.slice(2)}`);
      continue;
    }
    const point = line.replace(/^-\s*/, "").replace(/[.\s]+$/, "");
    const words = longWords(point);
    const hit = passages.find((p) => [...longWords(p.text)].some((w) => words.has(w)));
    out.push(hit ? `- Your note "${point}" is about this: ${hit.text.split(/\s+/).slice(0, 14).join(" ")}… ${hit.cite}` : `- ${point}. ${FROM_NOTES}`);
  }
  return out.join("\n");
}

/** "From the lecture material": the four topics from the counted facts, with a part per lecture file when there are two or more. */
function cannedLectureMaterial(req: AiRequest): string {
  const files = [...req.prompt.matchAll(/^## Lecture file: (.+)$/gm)].map((m) => m[1]);
  const reading = promptPassages(sectionOf(req.prompt, "Reading passages"))[0]?.cite;
  const parts = files.map((file) => {
    const body = sectionOf(req.prompt, `Lecture file: ${file}`);
    const pages = promptPassages(body).map((p) => p.cite);
    const at = pages[0] ?? "";
    const terms = [...body.matchAll(/([a-z][a-z-]+) \((\d+) slides: (\d+)/g)].slice(0, 2);
    const flagged = (body.split("Lines the material marks as important:\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- [")).map((l) => l.slice(2));
    const examples = (body.split("Lines that introduce an example:\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- [")).map((l) => l.slice(2));
    const moved = (l: string) => l.replace(/^(\[[^\]]+, p\. \d+\]) (.*)$/, "$2 $1");
    return [
      files.length > 1 ? `## ${file.replace(/\.[a-z0-9]+$/i, "")}` : "",
      "### What it spent its time on",
      terms.length ? terms.map((m) => `- The lecture comes back to ${m[1]} on ${m[2]} slides. [${file}, p. ${m[3]}]`).join("\n") : `The material moves through its topics one slide at a time. ${at}`,
      "### What it stressed",
      flagged.length ? flagged.map((l) => `- ${moved(l)}`).join("\n") : "Nothing in the material is marked as important.",
      "### The examples it used",
      examples.length ? examples.map((l) => `- ${moved(l)}`).join("\n") : "No slide introduces an example in so many words.",
      "### Where it differs from the readings",
      reading ? `The slides put the argument in shorter steps than the reading does. ${at} ${reading}` : "There are no readings this week to compare with.",
    ].filter(Boolean).join("\n\n");
  });
  return parts.join("\n\n");
}

/** Streamed text. The professor answers from the first passage it was sent and cites it; Explained and its fixes come in their text format; everything else gets the plain canned line. */
export function cannedText(req: AiRequest): string {
  cannedFailure(req);
  if (req.system.includes('write the "Explained" tab')) return cannedExplained(req);
  if (req.system.includes('write the "From your lecture notes" section')) return cannedLectureNotes(req);
  if (req.system.includes('write the "From the lecture material" section')) return cannedLectureMaterial(req);
  if (req.system.includes("You fix one section")) {
    const question = /## The section to write again\n## ([^\n]+)/.exec(req.prompt)?.[1] ?? "What does this part answer?";
    return `## ${question}\n\nThis section was written again so that every claim rests on the passages, building step by step on the one before it. ${passageCites(req)[0] ?? ""}`.trim();
  }
  if (req.system.includes("You are the student's professor") || req.system.includes("study partner for their Note to Self")) {
    const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0];
    return cite ? `Here is what your files say, in plain words. ${cite}` : "Your files don't cover that. Ask about a topic from the course.";
  }
  if (req.system.includes("quick study notes")) {
    const writeup = req.prompt.split("## The student's write-up\n")[1] ?? "";
    const lines = writeup.split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
    return (lines.length ? lines : ["Nothing to note."]).map((l) => `→ ${l}`).join("\n");
  }
  return "This is a canned reply.";
}

export const cannedEngine = (delayMs = Number(process.env.MARGIN_FAKE_DELAY_MS ?? 0)) =>
  new FakeEngine({
    json: cannedJson,
    text: cannedText,
    delayMs,
    // a slow layer's Explained, and lecture notes that say "(fake: slow)", stream over about ten seconds, for the browser tests
    delayFor: (req) => ((/\(fake: slow\)/.test(layerLine(req)) && req.system.includes('write the "Explained" tab')) || (req.task === "lecture-notes" && req.prompt.includes("(fake: slow)")) ? (req.task === "lecture-notes" ? 800 : 400) : undefined),
    hang: (req) => /\(fake: hang\)/.test(layerLine(req)) && req.system.includes('write the "Explained" tab'),
  });
