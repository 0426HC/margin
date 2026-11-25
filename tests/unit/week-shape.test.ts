import { describe, expect, it } from "vitest";
import { balancedCuts, FAR_OVER, HEAVY_LAYER_WORDS, MAX_LAYERS_PER_WEEK, opinionPart, shapeWeek, SPLIT_ABOVE, splitByParts, type ShapeLayer, type ShapePassage } from "@/lib/layers/week-shape";

// A week has two to five layers, one per idea. Code holds the AI's plan to that: never more than five, and an idea too long for one layer
// cut by its real parts (a court case's opinions, a new file, a new heading) while the week has room. A heavy week keeps five layers that
// each cover more.

const P = (file: string, section: string, words: number, text = "plain words"): ShapePassage => ({ file, sectionId: `${file}:${section}`, sectionTitle: section, words, text });
const all = (layers: ShapeLayer[]) => layers.flatMap((l) => l.passages).sort((a, b) => a - b);
const wordsOf = (l: ShapeLayer, ps: ShapePassage[]) => l.passages.reduce((n, i) => n + ps[i - 1].words, 0);
const one = (n: number, title = "The whole week"): ShapeLayer => ({ title, bigQuestion: "What does the week teach?", buildsOn: "", passages: Array.from({ length: n }, (_, i) => i + 1) });

describe("court cases have parts", () => {
  it.each([
    ["MR. JUSTICE SUTHERLAND delivered the opinion of the Court. The appellees were indicted…", "Opinion of the Court (Sutherland)"],
    ["MR. JUSTICE JACKSON, concurring in the judgment and opinion of the Court. That comprehensive and undefined…", "Jackson, concurring in the judgment"],
    ["MR. JUSTICE FRANKFURTER, concurring. Before the cares of the White House…", "Frankfurter, concurring"],
    ["MR. CHIEF JUSTICE VINSON, with whom MR. JUSTICE REED and MR. JUSTICE MINTON join, dissenting. In 1940…", "Vinson, dissenting"],
    ["PER CURIAM. The judgment is affirmed.", "Opinion of the Court"],
    ["MR. JUSTICE McREYNOLDS, dissenting. The court below…", "McReynolds, dissenting"],
    ["Syllabus. The President, by executive order, directed the seizure of the steel mills…", "The facts"],
  ])("finds where one starts: %s", (text, part) => expect(opinionPart(text)).toBe(part));

  it("a judge merely mentioned is not a part starting", () => {
    expect(opinionPart("As Justice Jackson later wrote in his famous concurrence, the President's power is at its lowest ebb.")).toBeNull();
    expect(opinionPart("The Court's opinion relies on Curtiss-Wright.")).toBeNull();
  });
});

describe("cutting a long idea by its real parts", () => {
  it("balances the pieces by words and prefers to cut where a part begins", () => {
    const ps = [P("Case.pdf", "Facts", 3000), P("Case.pdf", "Facts", 1000), P("Case.pdf", "Opinion", 3000, "MR. JUSTICE BLACK delivered the opinion of the Court."), P("Case.pdf", "Opinion", 1000)];
    expect(balancedCuts(ps, 2)).toEqual([2]); // the opinion starts at passage 3: cut there, not at the word midpoint inside the facts
  });

  it("names the pieces after the parts they start with", () => {
    const ps = [
      P("Youngstown.pdf", "Pages 1–3", 2500, "Syllabus. The President directed the seizure of the steel mills."),
      P("Youngstown.pdf", "Pages 4–9", 2500, "MR. JUSTICE BLACK delivered the opinion of the Court."),
      P("Youngstown.pdf", "Pages 10–14", 2500, "MR. JUSTICE JACKSON, concurring in the judgment and opinion of the Court."),
      P("Youngstown.pdf", "Pages 15–20", 2500, "MR. CHIEF JUSTICE VINSON, with whom MR. JUSTICE REED and MR. JUSTICE MINTON join, dissenting."),
    ];
    const pieces = splitByParts({ title: "Youngstown", bigQuestion: "Could Truman seize the steel mills?", buildsOn: "", passages: [1, 2, 3, 4] }, ps, 4);
    expect(pieces.map((p) => p.title)).toEqual(["Youngstown: The facts", "Youngstown: Opinion of the Court (Black)", "Youngstown: Jackson, concurring in the judgment", "Youngstown: Vinson, dissenting"]);
    expect(pieces[0].bigQuestion).toBe("Could Truman seize the steel mills?");
    expect(pieces[2].bigQuestion).toBe("What does Jackson, concurring in the judgment add to Youngstown?");
    expect(pieces.every((p) => p.bigQuestion.endsWith("?"))).toBe(true);
    expect(pieces[1].buildsOn).toBe("Follows Youngstown: The facts.");
  });
});

describe("holding a week to its shape", () => {
  it("never more than five layers: the shortest neighbours merge, every passage stays", () => {
    const ps = Array.from({ length: 7 }, (_, i) => P(`f${i}.pdf`, "s", 500 + i * 100));
    const seven = ps.map((_, i) => ({ title: `Idea ${i + 1}`, bigQuestion: `What is idea ${i + 1}?`, buildsOn: "", passages: [i + 1] }));
    const out = shapeWeek(seven, ps);
    expect(out).toHaveLength(MAX_LAYERS_PER_WEEK);
    expect(all(out)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out[0].title).toBe("Idea 1 and Idea 2"); // the two shortest neighbours
  });

  it("an idea over the limit is split while the week has room", () => {
    const ps = Array.from({ length: 10 }, (_, i) => P("Ch09.pdf", `Section ${Math.floor(i / 2) + 1}`, 1200));
    const out = shapeWeek([one(10, "The executive")], ps); // 12,000 words in one idea
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((l) => wordsOf(l, ps) <= SPLIT_ABOVE)).toBe(true);
    expect(all(out)).toEqual(ps.map((_, i) => i + 1));
  });

  it("POL326 week 3 is never one 47,000-word layer: a heavy week keeps five layers that each cover more", () => {
    // a textbook chapter, two long court cases and a lecture, about 47,000 words, proposed as one idea
    const ps = [
      ...Array.from({ length: 50 }, (_, i) => P("Ch09.pdf", `Section ${Math.floor(i / 10) + 1}`, 180)),
      ...Array.from({ length: 80 }, (_, i) => P("Curtiss-Wright.pdf", "Pages", 180, i === 0 ? "Syllabus. The joint resolution…" : i === 10 ? "MR. JUSTICE SUTHERLAND delivered the opinion of the Court." : i === 70 ? "MR. JUSTICE McREYNOLDS, dissenting." : "words")),
      ...Array.from({ length: 110 }, (_, i) => P("Youngstown.pdf", "Pages", 180, i === 0 ? "Syllabus. The President…" : i === 20 ? "MR. JUSTICE BLACK delivered the opinion of the Court." : i === 40 ? "MR. JUSTICE JACKSON, concurring." : i === 80 ? "MR. CHIEF JUSTICE VINSON, dissenting." : "words")),
      ...Array.from({ length: 21 }, () => P("POL326 Lecture #3.docx", "Notes", 180)),
    ];
    const total = ps.reduce((n, p) => n + p.words, 0);
    expect(total).toBeGreaterThan(46_000);
    const out = shapeWeek([one(ps.length, "Foreign affairs and the courts")], ps);
    expect(out).toHaveLength(MAX_LAYERS_PER_WEEK);
    const sizes = out.map((l) => wordsOf(l, ps));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(FAR_OVER); // about 10,000 at most: even pieces, not one giant layer
    expect(all(out)).toEqual(ps.map((_, i) => i + 1));
    // the cuts fall where real parts begin: a new file or an opinion
    const starts = out.slice(1).map((l) => ps[l.passages[0] - 1]);
    for (const p of starts) expect(p.text !== "words" || p.file !== ps[ps.indexOf(p) - 1].file).toBe(true);
  });

  it("a heavy week of uneven ideas (a long case beside short readings) is evened out: no layer far over the limit", () => {
    // four ideas of 9,000, 9,000, 24,000 and 5,000 words: splitting only the long one would leave two layers of 12,000
    const block = (file: string, n: number, opinionAt: number[] = []) => Array.from({ length: n }, (_, i) => P(file, `Part ${Math.floor(i / 10)}`, 180, opinionAt.includes(i) ? "MR. JUSTICE JACKSON, concurring." : "words"));
    const ps = [...block("Ch09.pdf", 50), ...block("Curtiss-Wright.pdf", 50), ...block("Youngstown.pdf", 133, [44, 88]), ...block("Lecture 3.docx", 28)];
    let at = 0;
    const idea = (n: number, title: string): ShapeLayer => ({ title, bigQuestion: `What is ${title}?`, buildsOn: "", passages: Array.from({ length: n }, () => ++at) });
    const ideas = [idea(50, "The chapter"), idea(50, "Curtiss-Wright"), idea(133, "Youngstown"), idea(28, "The lecture")];
    const out = shapeWeek(ideas, ps);
    expect(out).toHaveLength(MAX_LAYERS_PER_WEEK);
    expect(Math.max(...out.map((l) => wordsOf(l, ps)))).toBeLessThanOrEqual(FAR_OVER); // about 10,000 at most
    expect(all(out)).toEqual(ps.map((_, i) => i + 1));
    expect(out[0].title).toBe("The chapter");
    expect(out.map((l) => l.title).some((t) => t.startsWith("Youngstown"))).toBe(true);
  });

  it("a piece is named for the idea it mostly covers, never for a stray passage of the idea before; import labels like '(part 8 of 12)' are not names", () => {
    const ps = [
      ...Array.from({ length: 40 }, (_, i) => P("Curtiss.pdf", "Curtiss (part 1 of 3)", 180, i === 30 ? "MR. JUSTICE McREYNOLDS, dissenting." : "words")),
      ...Array.from({ length: 120 }, (_, i) => P("Youngstown.pdf", `Youngstown (part ${Math.floor(i / 12) + 1} of 10)`, 180)),
      ...Array.from({ length: 10 }, () => P("Lecture.docx", "Notes", 180)),
      ...Array.from({ length: 10 }, () => P("Other.pdf", "Other", 180)),
      ...Array.from({ length: 10 }, () => P("More.pdf", "More", 180)),
    ];
    let at = 0;
    const idea = (n: number, title: string): ShapeLayer => ({ title, bigQuestion: `What is ${title}?`, buildsOn: "", passages: Array.from({ length: n }, () => ++at) });
    const out = shapeWeek([idea(40, "Curtiss"), idea(120, "Youngstown"), idea(10, "Lecture"), idea(10, "Other"), idea(10, "More")], ps);
    for (const l of out) expect(l.title).not.toMatch(/part \d+ of|McReynolds/);
    for (const l of out) expect(l.bigQuestion).not.toMatch(/part \d+ of/);
  });

  it("leaves a well-shaped week alone", () => {
    const ps = [P("a.pdf", "s", 2000), P("b.pdf", "s", 2500), P("c.pdf", "s", 1800)];
    const three = [{ ...one(1, "A"), passages: [1] }, { ...one(1, "B"), passages: [2] }, { ...one(1, "C"), passages: [3] }];
    expect(shapeWeek(three, ps)).toEqual(three);
  });
});
