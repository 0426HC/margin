import { describe, expect, it } from "vitest";
import { explainLayer, explainMissing, fixSection, weekLayers, pickSource, reexplain, reviewSynthesis, reviewWriteback } from "@/lib/ai/prompts";

const passages = [
  { file: "fed10.txt", page: 3, text: "A faction is a number of citizens united by a common impulse." },
  { file: "fed10.txt", page: 4, text: "The causes of faction cannot be removed." },
];
const layer = { title: "What is a faction?", bigQuestion: "Why does Madison fear faction?" };

describe("explainLayer", () => {
  const notes = [
    { name: "Faction", aliases: ["party"], kind: "concept", what: "A group united against others' rights.", passages: 3 },
    { name: "Publius", aliases: [], kind: "person", what: "The pen name the papers are signed with.", passages: 1 },
  ];
  const p = explainLayer({ course: "POL101", week: { label: "Week 2: Faction", syllabus: "Federalist 10." }, layer, passages, notes, readings: [{ file: "fed10.txt", text: "Madison argues a large republic controls faction." }], previous: { title: "Prev", bigQuestion: "Q1?" }, next: { title: "Next", bigQuestion: "Q2?" }, length: { target: 1300, max: 1550, min: 800 } });
  it("asks for the shape: summary, sections answering sub-questions, the so what, and no table of terms", () => {
    for (const rule of [
      /Summary: 2 or 3 plain sentences/i,
      /each answering one sub-question of the big question; the sub-question is the section's heading/i,
      /explain how and why/i,
      /links to the week's question \(Week 2: Faction\) and to the course/i,
      /Never write a glossary, a list of terms, a "key terms" section or a table of definitions/,
    ]) expect(p.system).toMatch(rule);
    expect(p.system).not.toMatch(/Key concepts table|alsoMentioned|Also mentioned/);
  });
  it("explains every named thing inside the sections, where it matters: what it is, an example, why it matters", () => {
    expect(p.system).toMatch(/Every named concept, person, case, event, place and term is explained inside the sections, at the point where it matters, as part of answering that section's question: what it is, an example from the reading \(cited\), and why it matters/);
    expect(p.system).toMatch(/every entry in the first list must be explained in a section/);
  });
  it("asks for streamed plain text in Margin's format", () => {
    expect(p.system).toMatch(/# Summary[^]*## \(the first sub-question[^]*# So what/);
    expect(p.system).toMatch(/"Table: caption"/);
  });
  it("carries the study method's style rules and the citation rule for facts, not analysis", () => {
    for (const rule of [
      /Never a summary or close paraphrase of the reading/i,
      /table only for a typology .* explanation in each cell/i,
      /No story or narrative format/i,
      /analogy only if it really holds up/i,
      /Every fact, name, date, number and every claim about what a reading says carries a citation \[file, p\. N\]/,
      /Sentences of analysis or explanation .* need no citation, but they must rest on the cited material/i,
      /Never write a paragraph or bullet that is only a citation/i,
    ]) expect(p.system).toMatch(rule);
  });
  it("holds the explanation to the layer's share of about 4,000 words for the week", () => {
    expect(p.system).toMatch(/the summary, sections and so what together run to about 1300 words, never more than 1550/);
    expect(p.system).toContain("share of about 4,000 words for its whole week");
  });
  it("sends the course, the week, the layer and its neighbours, the brain's named things and reading notes, and the passages", () => {
    expect(p.prompt).toContain("What the syllabus says: Federalist 10.");
    expect(p.prompt).toMatch(/## Named in these passages: explain every one where it matters[^\n]*\n- Faction \(also: party\) \[concept\]: A group united/);
    expect(p.prompt).toMatch(/## Also named: say in a few words what each is where it comes up[^\n]*\n- Publius \[person\]/);
    expect(p.prompt).toContain("fed10.txt: Madison argues");
    expect(p.prompt).toContain("[fed10.txt, p. 3]\nA faction is a number");
    expect(p.prompt).toContain("Previous layer: Prev");
  });
  it("without the brain's notes yet, asks Claude to find every named thing itself", () => {
    const bare = explainLayer({ course: "POL101", week: { label: "Week 2", syllabus: null }, layer, passages, notes: [], length: { target: 600, max: 750, min: 350 } });
    expect(bare.prompt).toMatch(/find every named concept, person, case and term in the passages yourself/);
  });
});

describe("fixSection and explainMissing: only the failing part", () => {
  it("sends one section back with its problems and asks for that section only", () => {
    const p = fixSection({ layer, explained: "# Summary\nS\n\n## Q1?\nA\n\n## Q2?\nB", section: "## Q2?\n\nB", problems: ["It cites nothing."], passages, words: 200 });
    expect(p.system).toMatch(/Write that one section again so the problems listed are gone/);
    expect(p.system).toMatch(/Answer with the section only/);
    expect(p.prompt).toMatch(/## The section to write again\n## Q2\?/);
    expect(p.prompt).toContain("- It cites nothing.");
    expect(p.prompt).toContain("about 200 words");
  });
  it("asks where each unexplained name matters and the sentences that explain it there", () => {
    const p = explainMissing({ layer, sections: [{ n: 1, question: "Q1?", text: "A" }], missing: [{ name: "Faction", aliases: [], kind: "concept", what: "A group.", passages: 2 }], passages });
    expect(p.system).toMatch(/choose the section where it matters most and write one or two sentences \(at most 45 words\) that explain it there/);
    expect(p.prompt).toContain("### Section 1: Q1?");
    expect(p.prompt).toMatch(/## Not yet explained[^\n]*\n- Faction \[concept\]/);
  });
});

describe("reviewWriteback", () => {
  const p = reviewWriteback({ layer, passages, writing: "Faction is when people group up." });
  it("tells the reviewer to keep the student's wording and never invent facts", () => {
    expect(p.system).toMatch(/Keep their wording/);
    expect(p.system).toMatch(/Never invent names, dates, numbers, quotes or page numbers/);
    expect(p.system).toMatch(/fixes/);
    expect(p.system).toMatch(/cleanedUp/);
    expect(p.system).toMatch(/exactly one sentence/);
    expect(p.system).toMatch(/"approved" only if/);
  });
  it("sends the student's writing and the passages", () => {
    expect(p.prompt).toContain("Faction is when people group up.");
    expect(p.prompt).toContain("[fed10.txt, p. 4]");
  });
  it("on a resubmission includes the earlier attempt and the fixes that were asked for", () => {
    const again = reviewWriteback({ layer, passages, writing: "v2", previousWriting: "v1 text", previousFixes: ["name Madison"] });
    expect(again.prompt).toContain("v1 text");
    expect(again.prompt).toContain("- name Madison");
  });
});

describe("reviewSynthesis", () => {
  it("lists each layer with what the student saved, and flags unsaved layers", () => {
    const p = reviewSynthesis({ week: "Week 3 · Congress", layers: [{ ...layer, final: "My layer one." }, { title: "L2", bigQuestion: "Q?" }], passages, writing: "All together." });
    expect(p.prompt).toContain("My layer one.");
    expect(p.prompt).toContain("has not saved this layer yet");
    expect(p.system).toMatch(/pulls the layers together/);
    expect(p.prompt).toContain("Week 3 · Congress: its layers");
  });
});

describe("reexplain", () => {
  it("asks for a simpler, more basic explanation and another try; goes more basic on later attempts", () => {
    const p = reexplain({ layer, passages, attempt: 2, confusion: "what is a faction" });
    expect(p.system).toMatch(/more simply and from a more basic level/);
    expect(p.system).toMatch(/attempt 2/);
    expect(p.system).toMatch(/try writing the layer back again/);
    expect(p.prompt).toContain("what is a faction");
  });
});

describe("pickSource, weekLayers", () => {
  it("pickSource shows numbered passages and forbids touching the text", () => {
    const p = pickSource({ layer, passages: passages.map((x, i) => ({ ...x, n: i + 1 })) });
    expect(p.prompt).toContain("#2 [fed10.txt, p. 4]");
    expect(p.system).toMatch(/Never alter or quote the text/);
  });
  it("weekLayers sends the full text of every passage with the course, the week and what the syllabus says: 2 to 5 layers, long texts split by their real parts", () => {
    const long = "word ".repeat(400).trim();
    const p = weekLayers({
      course: "POL101 · Politics",
      week: "Week 3 · The Constitution",
      syllabus: "The Constitution. Reading: Ch 9.",
      minLayers: 2,
      passages: [
        { n: 1, file: "Ch09.pdf", page: 1, role: "Reading", section: "The executive", words: 400, text: long },
        { n: 2, file: "Youngstown.pdf", page: 4, role: "Reading", section: "Opinion", words: 170, text: "Mr. Justice Jackson, concurring. " + "word ".repeat(40), part: "Jackson, concurring" },
      ],
    });
    expect(p.system).toMatch(/2 to 5 layers\. Never more than 5\./);
    expect(p.system).toMatch(/cover everything important/);
    expect(p.system).toMatch(/up to about 10,000 words/);
    expect(p.system).toMatch(/court case splits into its facts, the majority opinion, concurrences and dissents/);
    expect(p.system).toMatch(/Every passage belongs to exactly one layer/);
    expect(p.prompt).toContain("Course: POL101 · Politics");
    expect(p.prompt).toContain("Week 3 · The Constitution");
    expect(p.prompt).toContain("The syllabus says about this week: The Constitution. Reading: Ch 9.");
    expect(p.prompt).toContain("== Ch09.pdf · Reading · The executive (400 words)");
    expect(p.prompt).toContain("#2 | p. 4 | 170 words | STARTS: Jackson, concurring\nMr. Justice Jackson, concurring.");
    expect(p.prompt).toContain(long); // the whole passage, not a preview
  });
  it("weekLayers lets a very light week have one layer", () => {
    const p = weekLayers({ course: "C", week: "Week 1", minLayers: 1, passages: [{ n: 1, file: "a.txt", page: 1, role: "Reading", section: "", words: 50, text: "short" }] });
    expect(p.system).toMatch(/1 to 5 layers \(this week is very light/);
  });

});
