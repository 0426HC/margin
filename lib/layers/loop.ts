/** The whole message, trimmed, lower-cased, curly quotes straightened, trailing punctuation dropped. */
const normalise = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/[\s.!?,;:…]+$/u, "")
    .replace(/\s+/g, " ");

/** "I don't get it" asks for a simpler explanation. Only when it is the whole message. */
export const isDontGetIt = (text: string) => ["i don't get it", "i dont get it"].includes(normalise(text));

/** Which text goes to Note to Self after a review: the student's own writing or the cleaned-up version. "no" sends nothing. */
export const SAVE_CHOICES = ["own", "refined", "no"] as const;
export type SaveChoice = (typeof SAVE_CHOICES)[number];
/** The version that is in Note to Self, labelled so the student always knows whose words they are. */
export type SavedVersion = "own" | "refined";

export const VERSION_WORD: Record<SavedVersion, string> = { own: "My own writing", refined: "Refined version" };

/** Share of the student's own words that survive in the cleaned-up version. The cleanup fixes; it does not rewrite. */
export const MIN_WORDING_KEPT = 0.6;

const wordsOf = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

export function wordingKept(draft: string, cleaned: string): number {
  const mine = wordsOf(draft);
  if (!mine.length) return 1;
  const pool = new Map<string, number>();
  for (const w of wordsOf(cleaned)) pool.set(w, (pool.get(w) ?? 0) + 1);
  let kept = 0;
  for (const w of mine) {
    const n = pool.get(w) ?? 0;
    if (n > 0) {
      kept++;
      pool.set(w, n - 1);
    }
  }
  return kept / mine.length;
}

/**
 * Whether to look beyond the layer's own passages: when under half of the student's longer words appear in them.
 * Feedback is grounded in the layer first, and project-wide search only fills a gap.
 */
export function layerCoversWriting(writing: string, layerText: string): boolean {
  const long = [...new Set(wordsOf(writing).filter((w) => w.length >= 6))];
  if (long.length < 4) return true;
  const have = new Set(wordsOf(layerText));
  return long.filter((w) => have.has(w)).length / long.length >= 0.5;
}
