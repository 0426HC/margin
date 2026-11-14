// A small excerpt for the style guide and component tests. Federalist No. 10 (Madison, 1787) is public domain,
// taken verbatim from Project Gutenberg #1404. Page numbers are illustrative.
import type { ExplainedPara, OriginalBlock } from "@/components/workspace/ReadingPane";
import type { ListUnit } from "@/components/workspace/SectionList";

export const FILE = "federalist-papers.pdf";

export const sampleUnits: ListUnit[] = [
  {
    id: "w1",
    title: "Week 1: Why a union",
    sections: [
      { id: "no1", title: "Federalist No. 1", status: "solid" },
      { id: "no2", title: "Federalist No. 2", status: "solid" },
      { id: "no6", title: "Federalist No. 6", status: "shaky" },
    ],
  },
  {
    id: "w2",
    title: "Week 2: The Union and faction",
    sections: [
      { id: "no9", title: "Federalist No. 9", status: "solid" },
      { id: "no10-1", title: "Federalist No. 10, part 1 of 3", status: "shaky" },
      { id: "no10-2", title: "Federalist No. 10, part 2 of 3", status: "new" },
    ],
  },
  {
    id: "w3",
    title: "Week 3: A republic’s structure",
    sections: [
      { id: "no39", title: "Federalist No. 39", status: "new" },
      { id: "no51", title: "Federalist No. 51", status: "new" },
    ],
  },
];

export const sampleSection = {
  title: "Federalist No. 10, part 1 of 3",
  subtitle: "The Same Subject Continued (The Union as a Safeguard Against Domestic Faction and Insurrection)",
  source: `${FILE}, pp. 38–40`,
  minutes: 5,
  why: "This is the problem Madison sets out to solve, so the rest of No. 10 is an answer to it. It builds on No. 9, where Hamilton argued that the Union protects the states from faction and insurrection, and it hands you the key term, faction, that the next part uses when it asks how to control its effects.",
};

export const sampleOriginal: OriginalBlock[] = [
  { kind: "title", text: "FEDERALIST No. 10", page: 38 },
  { kind: "dateline", text: "From the Daily Advertiser. Thursday, November 22, 1787.", page: 38 },
  { kind: "byline", text: "MADISON", page: 38 },
  { kind: "salutation", text: "To the People of the State of New York:", page: 38 },
  {
    kind: "p",
    text: "AMONG the numerous advantages promised by a well constructed Union, none deserves to be more accurately developed than its tendency to break and control the violence of faction. The friend of popular governments never finds himself so much alarmed for their character and fate, as when he contemplates their propensity to this dangerous vice.",
    page: 38,
  },
  {
    kind: "p",
    text: "By a faction, I understand a number of citizens, whether amounting to a majority or a minority of the whole, who are united and actuated by some common impulse of passion, or of interest, adversed to the rights of other citizens, or to the permanent and aggregate interests of the community.",
    page: 39,
  },
  {
    kind: "p",
    text: "There are two methods of curing the mischiefs of faction: the one, by removing its causes; the other, by controlling its effects.",
    page: 39,
  },
];

export const sampleExplained: ExplainedPara[] = [
  {
    text: "Madison opens by saying the best thing about a well-built Union is that it can break and control the violence of faction. Popular governments, he says, have always died of instability, injustice and confusion.",
    pages: [38],
  },
  {
    text: "Here is the definition everything else depends on. A faction is a group of citizens, a majority or a minority, who are united by a common passion or interest that works against other citizens’ rights or against the long-term interests of the community. Size does not matter.",
    pages: [39],
  },
  {
    text: "He then splits the problem in two. You can cure faction by removing its causes, or by controlling its effects.",
    pages: [39],
  },
];

export type SampleMessage =
  | { id: string; kind: "action"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "tutor"; text: string; label?: string }
  | { id: string; kind: "saved"; text: string };

export const sampleChat: SampleMessage[] = [
  { id: "c1", kind: "action", text: "Explain differently: simpler" },
  {
    id: "c2",
    kind: "tutor",
    text: "Think of a faction as a team that only cares about winning for itself, even when that hurts everyone else. The trouble is not its size, it is that it puts its own goals ahead of other people’s rights. [federalist-papers.pdf, p. 39]",
  },
  { id: "c3", kind: "user", text: "note to self: compare this with how Hamilton treats faction in No. 9" },
  { id: "c4", kind: "saved", text: "Saved to Notes." },
];
