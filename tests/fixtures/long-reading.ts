/**
 * A long made-up reading, about 40,000 words, shaped like a collection of numbered political essays (a long run of short papers, each with
 * a heading and a few paragraphs). Every word is invented here from a small vocabulary with a seeded random generator, so it is the same
 * on every run and contains no real course text. Used to measure scrolling and to size AI requests for heavy layers.
 */

const SUBJECTS = ["the assembly", "the council of Arden", "a free people", "the provinces", "the magistrates", "the charter", "a distant capital", "the courts", "the treasury", "the citizens of Velmar", "the frontier towns", "every faction", "the senate of Ostra", "the common good", "the guilds"];
const VERBS = ["must restrain", "cannot command", "will divide", "ought to balance", "may outgrow", "should answer to", "tends to weaken", "has always tested", "will in time correct", "is bound to check"];
const OBJECTS = ["the ambition of a few", "the power of the purse", "a standing militia", "the passions of the moment", "the rights of the smaller towns", "the trade of the river ports", "the election of officers", "the length of a term", "the voice of the majority", "the laws of the union", "the safety of the coast", "the public credit"];
const LINKS = ["Yet", "For this reason", "It follows that", "History shows that", "No one doubts that", "Experience teaches that", "In the same way", "On the other hand", "Above all", "We may grant that"];
const TAILS = ["when it is left without a rival", "unless it is divided among many hands", "as the older leagues discovered", "in a republic of wide extent", "if the people stay watchful", "so long as the charter is respected", "before the next season of elections", "without any help from abroad"];
const TOPICS = ["On the Dangers of Faction", "The Size of a Republic", "Of the Treasury and Its Keepers", "The Division of Powers", "On Standing Armies", "The Courts and Their Tenure", "Of Treaties with Foreign Ports", "The Senate of the Provinces", "On Elections and Their Seasons", "The Union of the River Towns"];

/** A small seeded generator (mulberry32), so the text never changes between runs. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LongReadingOptions {
  /** Roughly how many words in all. */
  words?: number;
  seed?: number;
}

/** The reading as plain text: numbered papers, each a heading line and paragraphs separated by blank lines. */
export function longReading({ words = 40_000, seed = 326 }: LongReadingOptions = {}): string {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const sentence = () => {
    const s = `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}.`;
    return r() < 0.45 ? `${pick(LINKS)} ${s}` : s.charAt(0).toUpperCase() + s.slice(1);
  };
  const out: string[] = [];
  let count = 0;
  for (let n = 1; count < words; n++) {
    const heading = `Paper No. ${n}. ${pick(TOPICS)}`;
    out.push(heading);
    count += heading.split(/\s+/).length;
    const paras = 4 + Math.floor(r() * 3);
    for (let p = 0; p < paras && count < words; p++) {
      const sentences = Array.from({ length: 5 + Math.floor(r() * 4) }, sentence);
      const para = sentences.join(" ");
      out.push(para);
      count += para.split(/\s+/).length;
    }
  }
  return out.join("\n\n") + "\n";
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
