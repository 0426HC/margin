/**
 * Builds the sample course in demo/sample-course: public-domain Federalist Papers (Project Gutenberg #1404)
 * plus a syllabus, study notes and slides written for the demo. Run: npx tsx scripts/make-sample-course.ts
 * The PDF, DOCX and PPTX are generated, so the folder exercises every file type with no private material.
 */
import fs from "node:fs";
import path from "node:path";
import { makeDocx, makePdf, makePptx, type PdfLine } from "../tests/fixtures/build";

const root = path.join("demo", "sample-course", "POL101 Federalist Seminar");
const write = (rel: string, data: string | Uint8Array) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

// Syllabus (Course overview)
write(
  "POL101 Syllabus F26.md",
  `# POL101: Founding Arguments

## What this course is

A short seminar on how the authors of the Federalist Papers argued for the Constitution. We read the papers closely, one at a time, and ask what each argument assumes.

## Weeks

- Week 1: Why a new government? Federalist No. 1.
- Week 2: Faction and the large republic. Federalist No. 10.
- Week 3: Separation of powers and checks. Federalist No. 51.

## Assessment

- Reading responses, one page each week: 30%.
- Midterm essay on faction: 30%.
- Final essay on checks and balances: 40%.
`,
);

// Week 2 reader, as a PDF with a running header, page numbers and a typographic title
const wrap = (text: string, width: number): string[] => {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  return cur ? [...lines, cur] : lines;
};
const paras = fs.readFileSync("demo/source/federalist-10.txt", "utf8").trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " "));
const [title, ...rest] = paras;
const body: PdfLine[] = [];
body.push({ text: title, size: 22, gap: 18 });
for (const p of rest) wrap(p, 92).forEach((line, i) => body.push({ text: line, size: 11, gap: i === 0 ? 9 : 0 }));
const pages: PdfLine[][] = [];
let cur: PdfLine[] = [];
let y = 0;
for (const l of body) {
  const h = (l.size ?? 12) * 1.35 + (l.gap ?? 0);
  if (y + h > 600) {
    pages.push(cur);
    cur = [];
    y = 0;
  }
  cur.push(l);
  y += h;
}
pages.push(cur);
write(
  "Week 2 - Faction/federalist-10-reader.pdf",
  makePdf(pages.map((p, i) => [{ text: "POL101 Course Reader: The Federalist Papers", size: 9 }, ...p, { text: String(i + 1), size: 9, gap: 530 - p.reduce((n, l) => n + (l.size ?? 12) * 1.35 + (l.gap ?? 0), 0) }])),
);

// Week 2 study notes, as a Word document with heading styles
const notes: { text: string; heading?: number; bullet?: boolean }[] = [
  { text: "Notes on Federalist No. 10", heading: 1 },
  { text: "What Madison is worried about", heading: 2 },
  { text: "Madison defines a faction as a group of citizens, whether a majority or a minority, united by a shared passion or interest that goes against the rights of others or the good of the whole. He treats faction as the main danger to popular government, because it is the thing that has destroyed earlier republics." },
  { text: "Two ways to deal with it", heading: 2 },
  { text: "remove the causes of faction", bullet: true },
  { text: "control its effects", bullet: true },
  { text: "He rejects the first: removing liberty would cure faction and kill the thing worth protecting, and giving everyone the same opinions is impossible. That leaves controlling the effects." },
  { text: "Why the large republic helps", heading: 2 },
  { text: "A larger territory contains more parties and interests, so it is harder for any one of them to form a majority and act together. Representatives also filter public opinion, which can be useful when the representatives are wiser than the crowd." },
];

// Week 3 slides
const slide = (title: string, ...bullets: string[]) => ({ title, bullets });
async function main() {
  write("Week 2 - Faction/Study notes.docx", await makeDocx(notes));
  write(
    "Week 3 - Checks and balances/Lecture 3 slides.pptx",
    await makePptx([
      slide("Checks and balances", "Federalist No. 51", "Why not just trust good people?"),
      slide("The problem", "Power tends to gather in one place", "Written limits alone will not hold", "So the structure itself has to resist"),
      slide("Separate departments", "Legislative, executive, judicial", "Each draws its power from a different source", "Each needs some independence from the others"),
      slide("Ambition against ambition", "Give each officeholder a personal stake in the office", "The interest of the person is tied to the rights of the place"),
      slide("Why divide the legislature?", "The legislature is the strongest branch", "Two houses with different modes of election", "Weakness in one branch is covered by the others"),
      slide("The veto", "A qualified executive veto defends the executive", "It also checks hasty law"),
      slide("Two layers of division", "Power is split between national and state governments", "Then each government is split again", "Rights get a double security"),
      slide("Faction again", "A society of many interests protects minorities", "Justice is the end of government", "Compare with Federalist No. 10"),
      slide("Questions for seminar", "Is ambition a reliable guard?", "What if the departments cooperate instead of competing?", "Where does this argument depend on size?"),
    ]),
  );
  console.log("sample course written to", root);
}
void main();
