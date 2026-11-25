/** Plain words about the brain's progress, safe to use in the browser. */

/** "Week 3", "Weeks 1-4", "Weeks 1-4 and 7": a set of weeks, as few words as possible. */
export function weeksPhrase(weeks: number[]): string {
  const ws = [...new Set(weeks)].sort((a, b) => a - b);
  if (!ws.length) return "";
  const runs: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let j = i;
    while (j + 1 < ws.length && ws[j + 1] === ws[j] + 1) j++;
    runs.push(j === i ? `${ws[i]}` : `${ws[i]}-${ws[j]}`);
    i = j + 1;
  }
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}` : runs[0];
  return `${ws.length === 1 ? "Week" : "Weeks"} ${list}`;
}

/** A name as a key for matching: no accents, lower case, no leading "the", punctuation as spaces. "The Devşirme" → "devsirme". */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'`]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}
