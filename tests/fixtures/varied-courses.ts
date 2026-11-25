/**
 * Made-up courses organised in very different ways, for testing how Margin's code handles Claude's reading of a folder. Every name,
 * author and topic is invented. Each course is a list of files (as bytes) plus its syllabus text.
 */
import { makeDocx, makePdf, makePptx } from "./build";
import type { CourseFile } from "./courses";

const enc = (t: string) => new TextEncoder().encode(t);
let n = 0;
/** Invented words, different every time, so no two texts share filler. */
const word = () => {
  let s = "";
  for (let k = ++n + 4000; k > 0; k = Math.floor(k / 26)) s = String.fromCharCode(97 + (k % 26)) + s;
  return `vr${s}`;
};
const sentence = (topic: string[], len = 14) => `${Array.from({ length: len }, (_, i) => (i % 4 === 0 ? topic[i % topic.length] : word())).join(" ")}.`;

/** A long reading as a PDF: `pages` pages of dense prose (about 420 words each), with no clue in its name or opening that it is a reading. */
export function longReadingPdf(pages: number, topic: string[]): Uint8Array {
  return makePdf(
    Array.from({ length: pages }, () =>
      Array.from({ length: 30 }, () => ({ text: sentence(topic) })),
    ),
  );
}
/** Slides saved as PDF: a title and three short lines a page. */
export const slidesPdf = (pages: number, topic: string[]) =>
  makePdf(Array.from({ length: pages }, (_, i) => [{ text: `${topic[i % topic.length]} ${i + 1}`, size: 24 }, { text: `${topic[0]} and ${topic[1]}` }, { text: `${topic[2] ?? topic[0]} matters` }]));
export const slidesPptx = (count: number, topic: string[]) => makePptx(Array.from({ length: count }, (_, i) => ({ title: `${topic[i % topic.length]} ${i + 1}`, bullets: [`${topic[0]} and ${topic[1]}`, `${topic[1]} again`] })));
const prose = (topic: string[], paragraphs: number) => Array.from({ length: paragraphs }, () => Array.from({ length: 5 }, () => sentence(topic)).join(" ")).join("\n\n");

// ---------------------------------------------------------------- 1. weeks as numbers, one folder per week

export const NUMBERED_SYLLABUS = `HIS210: Harbours and Empires
Schedule
Week 1 (Jan 8): Ports before empire. Reading: Orlen, Salt Roads, ch. 1.
Week 2 (Jan 15): The customs house. Reading: Tavi, Ledgers of the Coast.
Week 3 (Jan 22): Harbour cities at war. Reading: Orlen, Salt Roads, ch. 4.`;

export async function numberedWeeks(): Promise<CourseFile[]> {
  return [
    { relPath: "HIS210 syllabus.txt", bytes: enc(NUMBERED_SYLLABUS) },
    { relPath: "Week 1/Orlen ch1.pdf", bytes: longReadingPdf(4, ["ports", "salt", "orlen"]) },
    { relPath: "Week 1/Week 1 slides.pptx", bytes: await slidesPptx(6, ["ports", "empire", "salt"]) },
    { relPath: "Week 2/Tavi.pdf", bytes: longReadingPdf(3, ["customs", "ledger", "tavi"]) },
    { relPath: "Week 3/Orlen ch4.pdf", bytes: longReadingPdf(3, ["siege", "harbour", "orlen"]) },
  ];
}

// ---------------------------------------------------------------- 2. classes written in words, a reading week, a flat folder

export const WORDS_SYLLABUS = `GRK385: Coastal Societies
Class One, September 8: Origins of the coast. Readings: Varnel, Stone Harbours, pp. 1-24.
Class Two, September 15: Fishermen and lords. Readings: Quill, The Net and the Crown.
Class Three, September 22: The great migration. Readings: Varnel, Stone Harbours, pp. 25-55.
Fall Reading Week, September 29: no class.
Class Four, October 6: Islands under siege. Readings: Hesk, The Island Wars (selections).
Midterm test, October 13, in class.`;

export async function wordsAndReadingWeek(): Promise<CourseFile[]> {
  return [
    { relPath: "Course outline GRK385.pdf", bytes: makePdf([WORDS_SYLLABUS.split("\n").map((text) => ({ text }))]) },
    // long readings whose names carry no week and no clue word
    { relPath: "Varnel - The Harbour World and Its Inland Roads.pdf", bytes: longReadingPdf(25, ["harbour", "inland", "varnel"]) },
    { relPath: "Varnel - The Great Migration.pdf", bytes: longReadingPdf(31, ["migration", "coast", "varnel"]) },
    { relPath: "Quill_net_crown.pdf", bytes: longReadingPdf(12, ["fishermen", "lords", "quill"]) },
    { relPath: "slides-0915.pdf", bytes: slidesPdf(18, ["fishermen", "lords", "net"]) },
    { relPath: "slides-1006.pptx", bytes: await slidesPptx(14, ["islands", "siege", "hesk"]) },
  ];
}

// ---------------------------------------------------------------- 3. dates only, Readings and Lectures folders

export const DATES_SYLLABUS = `ECO150 Markets and Morals
Sept 9 — What a market is. Mirr, chapter 2.
Sept 16 — Prices and fairness. Dolan, "The Fair Price".
Sept 23 — Debt and promise. Mirr, chapter 5; Ostra, "Owing".`;

export async function datesOnly(): Promise<CourseFile[]> {
  return [
    { relPath: "ECO150 Syllabus.md", bytes: enc(DATES_SYLLABUS) },
    { relPath: "Readings/Mirr ch2.pdf", bytes: longReadingPdf(5, ["market", "exchange", "mirr"]) },
    { relPath: "Readings/Dolan The Fair Price.pdf", bytes: longReadingPdf(4, ["price", "fairness", "dolan"]) },
    { relPath: "Readings/Mirr ch5.pdf", bytes: longReadingPdf(5, ["debt", "promise", "mirr"]) },
    { relPath: "Lectures/sep09.pdf", bytes: slidesPdf(10, ["market", "exchange", "barter"]) },
    { relPath: "Lectures/sep16.pdf", bytes: slidesPdf(10, ["price", "fairness", "justice"]) },
  ];
}

// ---------------------------------------------------------------- 4. lecture numbers, with a reading week between lectures 6 and 7

export const LECTURES_SYLLABUS = `PHI220 Ethics of Care
Lecture 1: Care as a practice
Lecture 2: Dependence
Lecture 3: Attention
Lecture 4: Vulnerability
Lecture 5: Justice and care
Lecture 6: Midterm review
Reading week (no lectures)
Lecture 7: Care at work
Lecture 8: Care and the state`;

export async function lectureNumbers(): Promise<CourseFile[]> {
  return [
    { relPath: "PHI220/outline.docx", bytes: await makeDocx(LECTURES_SYLLABUS.split("\n").map((text, i) => ({ text, heading: i === 0 ? 1 : undefined }))) },
    { relPath: "PHI220/L06 - Midterm review/L06.pptx", bytes: await slidesPptx(5, ["review", "care", "justice"]) },
    { relPath: "PHI220/L07 - Care at work/L07.pptx", bytes: await slidesPptx(8, ["work", "care", "labour"]) },
    { relPath: "PHI220/L07 - Care at work/Brenn - Paid Care.pdf", bytes: longReadingPdf(6, ["work", "paid", "brenn"]) },
  ];
}

// ---------------------------------------------------------------- 5. a schedule table, the professor's notes exports, and the student's notes

export const TABLE_SYLLABUS = `# SOC330 Cities and Strangers

| Week | Date | Topic | Readings |
|---|---|---|---|
| 1 | Jan 10 | The stranger | Simmet, "The Stranger" |
| 2 | Jan 17 | Neighbours | Akka, *Close Quarters*, ch. 1-2 |
| 3 | Jan 24 | Public space | Loury, "Benches" |`;

export async function tableAndNotes(): Promise<CourseFile[]> {
  return [
    { relPath: "SOC330/SOC330 course info.md", bytes: enc(TABLE_SYLLABUS) },
    { relPath: "SOC330/Readings/Simmet.pdf", bytes: longReadingPdf(4, ["stranger", "distance", "simmet"]) },
    { relPath: "SOC330/Readings/Akka ch1-2.pdf", bytes: longReadingPdf(6, ["neighbour", "quarters", "akka"]) },
    // the professor's slides exported with speaker notes: a page per slide, with a paragraph of notes under each
    { relPath: "SOC330/Lectures/Week 2 Notes View.pdf", bytes: makePdf(Array.from({ length: 8 }, (_, i) => [{ text: `Neighbours ${i + 1}`, size: 22 }, { text: prose(["neighbour", "quarters", "street"], 1) }])) },
    { relPath: "SOC330/Lectures/Week 3 Notes Page.pdf", bytes: makePdf(Array.from({ length: 8 }, (_, i) => [{ text: `Benches ${i + 1}`, size: 22 }, { text: prose(["bench", "public", "square"], 1) }])) },
    { relPath: "SOC330/My notes/wk2.md", bytes: enc("# Week 2\n\n- neighbours are chosen less than we think\n- ask about Akka ch. 2") },
  ];
}

// ---------------------------------------------------------------- 6. twelve numbered classes with an unnumbered reading week, folders by class

/** Classes 1 to 12; class 7 is the midterm; the reading week between classes 7 and 8 has no number. Folders are named by class number. */
export const CLASSES_SYLLABUS = `HAR312: Harbour Towns of the Inland Sea
Outline of classes
Class 1 September 8 Course introduction
Class 2 September 15 Salt and the first ports
Class 3 September 22 The guild charters
Class 4 September 29 Lighthouses and law
Class 5 October 6 The plague years
Class 6 October 13 Shipwrights and their towns
Class 7 October 20 In-class midterm test
Reading Week: October 26-30, no class
Class 8 November 3 The customs wars
Class 9 November 10 Canals and the new river trade
Class 10 November 17 Harbour towns in decline
Class 11 November 24 Rebuilding the waterfront
Class 12 December 1 The harbour town today
Required readings are listed in each class folder.`;

export const CLASS_TOPICS: Record<number, string[]> = {
  2: ["salt", "port", "brine"], 3: ["guild", "charter", "seal"], 4: ["lighthouse", "law", "lamp"], 5: ["plague", "quarantine", "fever"],
  6: ["shipwright", "timber", "keel"], 8: ["customs", "tariff", "smuggler"], 9: ["canal", "river", "lock"], 10: ["decline", "silt", "debt"],
  11: ["waterfront", "rebuild", "pier"], 12: ["today", "tourism", "ferry"],
};

/** Week 2 to Week 12 folders (no Week 1 or Week 7 folder, as a student who had nothing for those classes would have), each with a
 * reading named "Wk NN - Author - Title.pdf" and, for some, the professor's slides. */
export async function twelveClasses(): Promise<CourseFile[]> {
  const files: CourseFile[] = [{ relPath: "HAR312/HAR312 - Syllabus - Fall.pdf", bytes: makePdf([CLASSES_SYLLABUS.split("\n").map((text) => ({ text }))]) }];
  for (const [w, topic] of Object.entries(CLASS_TOPICS)) {
    const nn = String(w).padStart(2, "0");
    files.push({ relPath: `HAR312/Week ${w}/Wk ${nn} - Varo - ${topic[0]} and ${topic[1]}.pdf`, bytes: longReadingPdf(3, topic) });
    if (Number(w) % 2 === 0) files.push({ relPath: `HAR312/Week ${w}/WK ${nn} - ${topic[0]} - Notes View.pdf`, bytes: slidesPdf(6, topic) });
  }
  return files;
}

// ---------------------------------------------------------------- 7. the student's own notes next to the professor's material

export const PROF = "Dr. Ilse Varo";
export const STUDENT = "Sam Okafor";
/** A student who joined mid-semester: the professor's slides and lecture-notes handouts (author: the professor) sit in lecture
 * folders next to the student's own typed notes (author: the student, written in fragments, arrows and questions to themself). */
export async function notesAndHandouts(): Promise<CourseFile[]> {
  return [
    { relPath: "HAR210/Lecture 1/HAR210 Lecture 1 slides.pptx", bytes: await makePptx([{ title: "Salt roads", bullets: ["the first ports", "brine and trade"] }, { title: "Why salt", bullets: ["preserving fish", "taxes"] }], undefined, { author: PROF }) },
    { relPath: "HAR210/Lecture 1/HAR210 Lecture 1 key points.docx", bytes: await makeDocx([{ text: "Lecture 1: Salt roads", heading: 1 }, { text: "The first ports grew where brine could be boiled cheaply and carried inland along established roads." }, { text: "Taxation of salt gave early harbour authorities a steady income, which paid for walls and piers." }], { author: PROF }) },
    { relPath: "HAR210/Lecture 1/lec1 stuff.docx", bytes: await makeDocx([{ text: "salt -> ports (why here??)" }, { text: "brine boiled = cheap, roads already there" }, { text: "tax $$ -> walls/piers" }, { text: "ask in tutorial: who collected the tax?" }], { author: STUDENT }) },
    { relPath: "HAR210/Lecture 2/HAR210 Lecture 2 slides.pdf", bytes: makePdf([[{ text: "Guild charters", size: 24 }, { text: "seals and rights" }], [{ text: "Who signed", size: 24 }, { text: "the town council" }]], { author: PROF }) },
    { relPath: "HAR210/Lecture 2/wk2 notes.pdf", bytes: makePdf([[{ text: "guilds = closed shop?" }, { text: "charter -> rights, seal = proof" }, { text: "q: did every town have one??" }]], { author: STUDENT }) },
  ];
}

// ---------------------------------------------------------------- 6. one chapter saved in two week folders, its pages split by the syllabus

export const SPLIT_SYLLABUS = `HIS300: Salt and Empire
Schedule
Week 1 (Jan 8): Ports before empire. Reading: Orlen, Salt Roads, pp. 7-12. Tavi, Ledgers.
Week 2 (Jan 15): The customs wars. Reading: Orlen, Salt Roads, pp. 13-18. Hesk, Island Wars.
Week 3 (Jan 22): After the wars. Reading: Quill, The Net and the Crown.`;

/**
 * A book chapter as a PDF, printed pp. `first`… (a running header carries the printed number, as books do), each page about its own
 * made-up topic word so a test can tell the pages apart.
 */
export function bookChapterPdf(first: number, pages: number, topicOf: (printed: number) => string): Uint8Array {
  return makePdf(
    Array.from({ length: pages }, (_, i) => {
      const printed = first + i;
      const header = printed % 2 === 0 ? `${printed} Salt roads of the coast` : `Ports before empire ${printed}`;
      return [{ text: header, size: 9 }, { text: "" }, ...Array.from({ length: 24 }, () => ({ text: sentence([topicOf(printed), "harbour", "orlen"]) }))];
    }),
  );
}

export async function splitChapter(): Promise<CourseFile[]> {
  const chapter = bookChapterPdf(7, 12, (p) => `page${p}word`);
  return [
    { relPath: "HIS300/HIS300 syllabus.txt", bytes: enc(SPLIT_SYLLABUS) },
    { relPath: "HIS300/Week 1/Wk 01 - Orlen - Salt Roads ch 2.pdf", bytes: chapter },
    { relPath: "HIS300/Week 1/Wk 01 - Tavi - Ledgers.pdf", bytes: longReadingPdf(3, ["customs", "ledger", "tavi"]) },
    { relPath: "HIS300/Week 2/Wk 01-02 - Orlen - Salt Roads ch 2.pdf", bytes: chapter },
    { relPath: "HIS300/Week 2/Wk 02 - Hesk - Island Wars.pdf", bytes: longReadingPdf(3, ["siege", "island", "hesk"]) },
    { relPath: "HIS300/Week 3/Wk 03 - Quill - The Net and the Crown.pdf", bytes: longReadingPdf(3, ["net", "crown", "quill"]) },
  ];
}
