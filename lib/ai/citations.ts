// Citations look like [file, p. N]. The UI turns them into buttons that open the source at that page.
export type CitationPart = { text: string } | { cite: { file: string; page: number; raw: string } };

// The file name may itself contain one level of square brackets, e.g. [Reader [2024].pdf, p. 3].
const CITE = /\[((?:[^\[\]]|\[[^\[\]]*\])+?), p\. (\d+)\]/g;

export function splitCitations(input: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let last = 0;
  for (const m of input.matchAll(CITE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: input.slice(last, i) });
    parts.push({ cite: { file: m[1], page: Number(m[2]), raw: m[0] } });
    last = i + m[0].length;
  }
  if (last < input.length) parts.push({ text: input.slice(last) });
  return parts;
}

export interface SentPassage {
  file: string;
  page: number;
}

/** Every citation in the text that was not in the passages sent to the model, so it can never become a link. */
export function invalidCitations(input: string, sent: SentPassage[]): string[] {
  const ok = new Set(sent.map((p) => `${p.file}\u0000${p.page}`));
  return splitCitations(input).flatMap((part) => ("cite" in part && !ok.has(`${part.cite.file}\u0000${part.cite.page}`) ? [part.cite.raw] : []));
}

/** Strip citations that point at nothing, and report which were stripped. The UI never shows a link to a made-up source. */
export function stripInvalidCitations(input: string, sent: SentPassage[]): { text: string; stripped: string[] } {
  const bad = new Set(invalidCitations(input, sent));
  if (!bad.size) return { text: input, stripped: [] };
  const text = splitCitations(input)
    .map((part) => ("cite" in part ? (bad.has(part.cite.raw) ? "" : part.cite.raw) : part.text))
    .join("")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return { text, stripped: [...bad] };
}
