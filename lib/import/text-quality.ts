/**
 * Cheap checks on extracted text. They catch OCR noise without a dictionary: stray symbols, digits inside
 * words, single letters, words with no vowels. Used to keep junk out of titles and to flag poor scans.
 */

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const NUMBER = /^\p{N}[\p{N}.,:%/–-]*$/u;
const WORD = /^\p{L}+(?:['’-]\p{L}+)*$/u;
const VOWEL = /[aeiouyàáâäãåèéêëìíîïòóôöõùúûüœæ]/i;
const ABBREVIATIONS = new Set(["pp", "vs", "cf", "mr", "mrs", "ms", "dr", "st", "nd", "rd", "th", "vol", "ed", "eds", "ch", "fig", "no"]);
const PUNCTUATION_OK = /^[—–\-&§¶•·*/]+$/;

/** Is this whitespace-separated token a plausible word, number or mark? */
function tokenGood(raw: string): boolean {
  const t = raw.replace(EDGE, "");
  if (!t) return PUNCTUATION_OK.test(raw);
  if (NUMBER.test(t)) return true;
  if (!WORD.test(t)) return false;
  if (/\p{Ll}\p{Lu}/u.test(t) && !/^Mc\p{Lu}/u.test(t)) return false; // OCR often flips case mid-word
  if (t.length === 1) return /^[aAI]$/.test(t);
  if (VOWEL.test(t)) return true;
  return ABBREVIATIONS.has(t.toLowerCase()) || (t === t.toUpperCase() && t.length <= 6);
}

const tokensOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** The share of tokens that look like real words, numbers or marks. 0 for no text. */
export function textQuality(text: string): number {
  const tokens = tokensOf(text);
  return tokens.length ? tokens.filter(tokenGood).length / tokens.length : 0;
}

/** Does this line look like a real heading, not a stray letter, a fragment or OCR noise? */
export function isRealHeading(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 200) return false;
  if (!/^[\p{L}\p{N}"“‘'(\[]/u.test(t) || /^\p{Ll}/u.test(t)) return false;
  if (/[,;–—-]$/.test(t)) return false;
  const tokens = tokensOf(t);
  if (tokens.length > 25) return false;
  if (!tokens.some((w) => w.replace(/[^\p{L}]/gu, "").length >= 3)) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters / t.replace(/\s/g, "").length < 0.7) return false;
  return tokens.filter(tokenGood).length / tokens.length >= 0.75;
}

const MIN_WORDS_PER_PAGE = 25;
export const LOW_QUALITY = 0.85;

/** A PDF's text quality: word quality, capped when the pages hold almost no text (usually a scan). */
export function pdfTextQuality(text: string, pageCount: number): number {
  const q = textQuality(text);
  const perPage = tokensOf(text).length / Math.max(1, pageCount);
  return perPage < MIN_WORDS_PER_PAGE ? Math.min(q, 0.5) : q;
}

export const isLowQuality = (score: number | null | undefined): boolean => score != null && score < LOW_QUALITY;
