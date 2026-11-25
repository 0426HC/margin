/**
 * Test courses that look like real ones, built in code as real PDF, PowerPoint, Word and text files. Nothing here comes from a real
 * course: the topics are generic, the words are made up. Used by unit tests (as bytes) and e2e tests (written to a temporary folder).
 */
import fs from "node:fs";
import path from "node:path";
import { makeDocx, makePdf, makePptx } from "./build";

export interface CourseFile {
  relPath: string;
  bytes: Uint8Array;
}

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
/** A made-up word of letters only, different for every n ("zqab", "zqac"…), so no two topics share filler. */
const filler = (n: number) => {
  let s = "";
  for (let k = n + 18278; k > 0; k = Math.floor(k / 26)) s = String.fromCharCode(97 + (k % 26)) + s;
  return `zq${s}`;
};
/** Prose about a topic: its own words woven through filler, so the topic can be told apart from the others by its words. */
function prose(topic: string[], paragraphs: number): string[] {
  return Array.from({ length: paragraphs }, (_, p) => {
    const words: string[] = [];
    for (let i = 0; i < 70; i++) words.push(i % 5 === 0 ? topic[(i / 5 + p) % topic.length] : filler(++seed));
    return `${words.join(" ")}.`;
  });
}
const pdf = (title: string, topic: string[], pages = 3) =>
  makePdf(Array.from({ length: pages }, (_, i) => [{ text: i === 0 ? title : "", size: 18 }, ...prose(topic, 3).flatMap((t) => t.match(/.{1,90}(\s|$)/g)!.map((l) => ({ text: l.trim() })))]));
const slides = (title: string, topic: string[], n = 6) => makePptx(Array.from({ length: n }, (_, i) => ({ title: i === 0 ? title : `${topic[i % topic.length]} ${i}`, bullets: [`${topic[0]} and ${topic[1]}`, `${topic[2]} ${topic[3] ?? topic[0]}`, `${topic[(i + 1) % topic.length]} matters`] })));

export const TOPICS = {
  intro: ["presidency", "persuasion", "bargaining", "neustadt", "power"],
  founding: ["federalist", "hamilton", "energy", "executive", "unity"],
  congress: ["mayhew", "reelection", "electoral", "committees", "connection"],
  interbranch: ["binder", "gridlock", "divided", "veto", "stalemate"],
  president: ["skowronek", "regime", "reconstruction", "disjunction", "order"],
  vietnam: ["halberstam", "vietnam", "escalation", "brightest", "quagmire"],
  courts: ["judiciary", "review", "marbury", "doctrine", "precedent"],
  parties: ["parties", "polarization", "primaries", "coalitions", "realignment"],
  war: ["warpowers", "resolution", "commander", "tonkin", "authorization"],
};

export const POL326_SYLLABUS = `POL326: The Presidency and Congress
Fall term. This is a 12-week course.

Schedule
Week 1 (Sept 9): Introduction. Reading: Neustadt.
Week 2 (Sept 16): The founding and the executive. Reading: Federalist 70.
Week 3 (Sept 23): Congress. Reading: Mayhew.
Week 4 (Sept 30): Interbranch politics. Reading: Binder.
Week 5 (Oct 7): The president in political time. Reading: Skowronek.
Week 6 (Oct 14): Midterm exam, in class.
Week 7 (Oct 21): Reading week, no class.
Week 8 (Oct 28): War powers.
Week 9 (Nov 4): Courts.
Week 10 (Nov 11): Parties.
Week 11 (Nov 18): Parties and polarization.
Week 12 (Nov 25): Review.

Grading
Midterm exam, October 14: 30%
Final exam (exam period): 40%
Optional reading: Halberstam on Vietnam.`;

const LECTURES: [string, keyof typeof TOPICS, string][] = [
  ["Introduction", "intro", "Neustadt - Presidential Power.pdf"],
  ["The Founding", "founding", "Federalist 70.pdf"],
  ["Congress", "congress", "Mayhew - The Electoral Connection.pdf"],
  ["Interbranch Politics", "interbranch", "Binder - Stalemate.pdf"],
  ["The President", "president", "Skowronek - Political Time.pdf"],
];

/** A POL326-style folder: Syllabus.pdf, "Lecture 01 - Introduction" to "Lecture 05 - The President", Extra Readings, Midterm Focus, My notes. */
export async function pol326(): Promise<CourseFile[]> {
  const files: CourseFile[] = [{ relPath: "Syllabus.pdf", bytes: makePdf([POL326_SYLLABUS.split("\n").map((text) => ({ text }))]) }];
  for (const [i, [name, topic, reading]] of LECTURES.entries()) {
    const folder = `Lecture ${String(i + 1).padStart(2, "0")} - ${name}`;
    files.push({ relPath: `${folder}/POL326 Lecture ${i + 1}.pptx`, bytes: await slides(name, TOPICS[topic]) });
    files.push({ relPath: `${folder}/${reading}`, bytes: pdf(reading.replace(/\.pdf$/, ""), TOPICS[topic]) });
  }
  files.push({ relPath: "Extra Readings/Halberstam - The Best and the Brightest.pdf", bytes: pdf("The Best and the Brightest", TOPICS.vietnam) });
  files.push({ relPath: "Extra Readings/Neustadt revisited.pdf", bytes: pdf("Neustadt revisited", TOPICS.intro, 2) });
  files.push({
    relPath: "Midterm Focus/Midterm review guide.pdf",
    bytes: makePdf([[{ text: "Midterm review guide", size: 18 }, { text: "The midterm covers Lectures 1-5 and the assigned readings." }, { text: "Key terms: persuasion, energy in the executive, the electoral connection, gridlock, political time." }, { text: "You should be able to explain each in two or three sentences." }]]),
  });
  files.push({
    relPath: "My notes/Week 2 notes.docx",
    bytes: await makeDocx([
      { text: "Founding notes", heading: 1 },
      { text: "Hamilton wants energy in the executive", bullet: true },
      { text: "unity -> accountability", bullet: true },
      { text: "Ask about Federalist 70 in seminar." },
    ]),
  });
  return files;
}

/** Later weeks for POL326, added after the plan was approved: war powers (week 8) and courts (week 9), after the midterm. */
export async function pol326Later(): Promise<CourseFile[]> {
  return [
    { relPath: "Lecture 06 - War Powers/POL326 Lecture 6.pptx", bytes: await slides("War Powers", TOPICS.war) },
    { relPath: "Lecture 06 - War Powers/War Powers Resolution.pdf", bytes: pdf("War Powers Resolution", TOPICS.war) },
    { relPath: "Lecture 07 - Courts/POL326 Lecture 7.pptx", bytes: await slides("Courts", TOPICS.courts) },
    { relPath: "Lecture 07 - Courts/Marbury.pdf", bytes: pdf("Marbury", TOPICS.courts) },
  ];
}

/** No syllabus and no number anywhere. */
export async function noStructure(): Promise<CourseFile[]> {
  return [
    { relPath: "Readings/Neustadt.pdf", bytes: pdf("Neustadt", TOPICS.intro) },
    { relPath: "Readings/Mayhew.pdf", bytes: pdf("Mayhew", TOPICS.congress) },
    { relPath: "Readings/Binder.pdf", bytes: pdf("Binder", TOPICS.interbranch) },
    { relPath: "Slides/Overview.pptx", bytes: await slides("Overview", TOPICS.president) },
  ];
}

/** A ten-week course whose syllabus lists ten weeks and two midterms. Files for weeks 1 to 4. */
export async function tenWeeks(): Promise<CourseFile[]> {
  const syllabus = ["Course outline", ...Array.from({ length: 10 }, (_, i) => `Week ${i + 1}: ${i === 3 ? "Midterm 1" : i === 7 ? "Midterm 2" : `Topic ${i + 1}`}`), "Final exam: during the exam period."].join("\n");
  const topics: (keyof typeof TOPICS)[] = ["intro", "founding", "congress"];
  return [
    { relPath: "Course outline.md", bytes: enc(syllabus) },
    ...topics.map((t, i) => ({ relPath: `Week ${i + 1}/${t}.pdf`, bytes: pdf(t, TOPICS[t]) })),
  ];
}

/** Write a course to a folder on disk (for e2e), under `root/name`. Returns the course folder. */
export function writeCourse(root: string, name: string, files: CourseFile[]): string {
  const dir = path.join(root, name);
  for (const f of files) {
    const p = path.join(dir, f.relPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.bytes);
  }
  return dir;
}

// ----------------------------------------------------------------------------- a POL326-style course as it really arrives

/**
 * A long text as a PDF: `pages` pages of about 280 words on the topic. `starts` puts a line at the top of a page, where a real part of a
 * court case begins ("MR. JUSTICE JACKSON, concurring."). Made up: only the case names are real, the words are filler.
 */
function longPdf(title: string, topic: string[], pages: number, starts: Record<number, string> = {}, heading?: (page: number) => string | null) {
  return makePdf(
    Array.from({ length: pages }, (_, i) => {
      const lines: PdfLineIn[] = [];
      if (i === 0) lines.push({ text: title, size: 18 });
      const h = heading?.(i);
      if (h) lines.push({ text: h, size: 15, gap: 6 });
      if (starts[i]) lines.push(...starts[i].match(/.{1,85}(\s|$)/g)!.map((l, k) => ({ text: l.trim(), gap: k === 0 ? 4 : 0 })));
      for (const para of prose(topic, 4)) lines.push(...para.match(/.{1,90}(\s|$)/g)!.map((l, k) => ({ text: l.trim(), gap: k === 0 ? 6 : 0 })));
      return lines;
    }),
  );
}
type PdfLineIn = { text: string; size?: number; gap?: number };

export const POL326_REAL_SYLLABUS = `POL326: The American Presidency
Fall term. This is a 12-week course.

Schedule
Week 1 (Sept 9): The presidency in the Constitution. Reading: Ch01 The Constitutional Presidency.
Week 2 (Sept 16): Power and persuasion. Reading: Ch04 Presidential Power.
Week 3 (Sept 23): Foreign affairs and the courts. Reading: Ch09 Foreign Policy; United States v. Curtiss-Wright; Youngstown Sheet & Tube Co. v. Sawyer.
Week 4 (Sept 30): Congress and the president. Reading: Ch06 Congress.
Week 5 (Oct 7): The president in political time. Reading: Ch11 Political Time.
Week 6 (Oct 14): Midterm exam, in class.
Week 7 (Oct 21): Reading week, no class.
Week 8 (Oct 28): War powers. Optional: Halberstam, The Best and the Brightest.
Week 9 (Nov 4): The courts and the president.
Week 10 (Nov 11): Parties.
Week 11 (Nov 18): The unitary executive.
Week 12 (Nov 25): Review.

Optional readings: Neustadt revisited (Week 2).

Grading
Midterm exam, October 14: 30%
Final exam (exam period): 40%`;

const CHAPTERS: [number, string, string, keyof typeof TOPICS][] = [
  [1, "The Constitutional Presidency", "Ch01 The Constitutional Presidency.pdf", "founding"],
  [2, "Power and persuasion", "Ch04 Presidential Power.pdf", "intro"],
  [4, "Congress and the president", "Ch06 Congress.pdf", "congress"],
  [5, "The president in political time", "Ch11 Political Time.pdf", "president"],
];

const lectureDocx = (n: number, title: string, topic: string[]) =>
  makeDocx([
    { text: `POL326 Lecture ${n}: ${title}`, heading: 1 },
    ...prose(topic, 6).flatMap((p, i) => [{ text: `${topic[i % topic.length]} and the argument`, heading: 2 as const }, { text: p }, { text: `${topic[(i + 1) % topic.length]} in one line`, bullet: true }]),
  ]);

/** Week 3's readings: a textbook chapter and two long court cases, about 47,000 words with the lecture. Made once, shared by the copies. */
async function week3() {
  const chapter = longPdf("Chapter 9: Foreign Policy", TOPICS.war, 40, {}, (p) => (p % 10 === 0 ? `9.${p / 10 + 1} ${["The executive abroad", "Treaties and agreements", "Emergency powers", "The courts and foreign affairs"][p / 10]}` : null));
  const curtiss = longPdf("United States v. Curtiss-Wright Export Corp.", TOPICS.war, 36, {
    0: "Syllabus. The joint resolution of Congress authorized the President to forbid the sale of arms.",
    5: "MR. JUSTICE SUTHERLAND delivered the opinion of the Court.",
    31: "MR. JUSTICE McREYNOLDS, dissenting.",
  });
  const youngstown = longPdf("Youngstown Sheet & Tube Co. v. Sawyer", TOPICS.courts, 86, {
    0: "Syllabus. The President, by executive order, directed the seizure of the steel mills.",
    10: "MR. JUSTICE BLACK delivered the opinion of the Court.",
    27: "MR. JUSTICE FRANKFURTER, concurring.",
    42: "MR. JUSTICE JACKSON, concurring in the judgment and opinion of the Court.",
    64: "MR. CHIEF JUSTICE VINSON, with whom MR. JUSTICE REED and MR. JUSTICE MINTON join, dissenting.",
  });
  return { chapter, curtiss, youngstown, lecture: await lectureDocx(3, "Foreign affairs and the courts", TOPICS.war) };
}

/**
 * A POL326-style folder as a student really has it: "Lecture 01 - …" to "Lecture 05 - …", each with a textbook chapter (or court cases)
 * and the professor's "POL326 Lecture #N.docx"; Syllabus.pdf with each week's title and reading list; "Extra Readings"; and a "Midterm
 * Focus" folder holding copies of two week 3 readings plus "00 - POL326 Midterm Focus Guide.md". Week 3 alone is about 47,000 words.
 */
export async function pol326Real(): Promise<CourseFile[]> {
  const files: CourseFile[] = [{ relPath: "Syllabus.pdf", bytes: makePdf([POL326_REAL_SYLLABUS.split("\n").map((text) => ({ text }))]) }];
  const folders = ["Lecture 01 - The Constitutional Presidency", "Lecture 02 - Power and Persuasion", "Lecture 03 - Foreign Affairs", "Lecture 04 - Congress", "Lecture 05 - Political Time"];
  for (const [week, title, file, topic] of CHAPTERS) {
    const folder = folders[week - 1];
    files.push({ relPath: `${folder}/${file}`, bytes: longPdf(`Chapter ${file.slice(2, 4).replace(/^0/, "")}: ${title}`, TOPICS[topic], 10) });
    files.push({ relPath: `${folder}/POL326 Lecture #${week}.docx`, bytes: await lectureDocx(week, title, TOPICS[topic]) });
  }
  const w3 = await week3();
  files.push({ relPath: `${folders[2]}/Ch09 Foreign Policy.pdf`, bytes: w3.chapter });
  files.push({ relPath: `${folders[2]}/United States v. Curtiss-Wright.pdf`, bytes: w3.curtiss });
  files.push({ relPath: `${folders[2]}/Youngstown Sheet & Tube Co. v. Sawyer.pdf`, bytes: w3.youngstown });
  files.push({ relPath: `${folders[2]}/POL326 Lecture #3.docx`, bytes: w3.lecture });
  files.push({ relPath: "Extra Readings/Neustadt revisited.pdf", bytes: longPdf("Neustadt revisited", TOPICS.intro, 3) });
  files.push({ relPath: "Extra Readings/Halberstam - The Best and the Brightest.pdf", bytes: longPdf("The Best and the Brightest", TOPICS.vietnam, 3) });
  files.push({ relPath: "Midterm Focus/Ch09 Foreign Policy.pdf", bytes: w3.chapter });
  files.push({ relPath: "Midterm Focus/Youngstown Sheet & Tube Co. v. Sawyer.pdf", bytes: w3.youngstown });
  files.push({
    relPath: "Midterm Focus/00 - POL326 Midterm Focus Guide.md",
    bytes: enc("# POL326 Midterm Focus Guide\n\nThe midterm covers Lectures 1-5 and the assigned readings.\n\n## Key terms\n\n- Persuasion\n- The steel seizure and Jackson's three zones\n- Political time\n\nYou should be able to explain each in two or three sentences."),
  });
  return files;
}

/** A course of any length: a syllabus listing `weeks` weeks ("Week 1: Topic 1" …) and a reading for each of the first `withFiles`. */
export function anyLength(weeks: number, withFiles: number): CourseFile[] {
  const syllabus = ["# Course outline", "", ...Array.from({ length: weeks }, (_, i) => `- Week ${i + 1}: Topic ${i + 1}`)].join("\n");
  const topics = Object.values(TOPICS);
  return [
    { relPath: "Course outline.md", bytes: enc(syllabus) },
    ...Array.from({ length: withFiles }, (_, i) => ({ relPath: `Week ${i + 1}/reading ${i + 1}.md`, bytes: enc(`# Reading ${i + 1}\n\n${prose(topics[i % topics.length], 6).join("\n\n")}`) })),
  ];
}
