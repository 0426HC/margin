import { invalidCitations, splitCitations, stripInvalidCitations, type SentPassage } from "@/lib/ai/citations";

/**
 * The text format of the week's Lecture tab, as Claude streams it and as it is stored: `## ` a part (one lecture of two), `### ` a topic,
 * `- ` a bullet, anything else a paragraph; blank lines between blocks. Pure, so the page can read a section while it is still arriving.
 */

export type LectureBlock = { type: "part"; text: string } | { type: "topic"; text: string } | { type: "paragraph"; text: string } | { type: "bullets"; items: string[] };

/** The marker on a point that comes only from the student's own notes. It never carries a citation. */
export const FROM_NOTES = "(from your notes)";

export function readLectureText(text: string): LectureBlock[] {
  const out: LectureBlock[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    // markup the format doesn't have is dropped rather than shown as stray symbols
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
    if (!line) {
      out.push({ type: "paragraph", text: "" }); // a break: the next line starts a new block
      continue;
    }
    const last = out[out.length - 1];
    if (/^#{1,2} /.test(line)) out.push({ type: "part", text: line.replace(/^#+\s*/, "") });
    else if (/^#{3,} /.test(line)) out.push({ type: "topic", text: line.replace(/^#+\s*/, "") });
    else if (/^[-*•] /.test(line)) {
      const item = line.replace(/^[-*•]\s+/, "");
      if (last?.type === "bullets") last.items.push(item);
      else out.push({ type: "bullets", items: [item] });
    } else if (last?.type === "paragraph" && last.text) last.text = `${last.text} ${line}`;
    else out.push({ type: "paragraph", text: line });
  }
  return out.filter((b) => b.type !== "paragraph" || b.text);
}

/** The lines of a section that make claims: paragraphs and bullets. */
export const claimsOf = (text: string): string[] => readLectureText(text).flatMap((b) => (b.type === "paragraph" ? [b.text] : b.type === "bullets" ? b.items : []));

/** What is wrong with a written section: citations that point at nothing sent, and (for the notes section) points with neither a citation nor the notes marker. */
export function lectureProblems(text: string, sent: SentPassage[], { notes }: { notes: boolean }): { invalid: string[]; unmarked: string[] } {
  const claims = claimsOf(text);
  const invalid = [...new Set(claims.flatMap((c) => invalidCitations(c, sent)))];
  const unmarked = notes ? claims.filter((c) => !c.includes(FROM_NOTES) && !splitCitations(c).some((p) => "cite" in p)) : [];
  return { invalid, unmarked };
}

/** The section with every citation that points at nothing sent taken out, so no link to a made-up page is ever shown. */
export const stripLectureCitations = (text: string, sent: SentPassage[]) =>
  text
    .split("\n")
    .map((l) => stripInvalidCitations(l, sent).text)
    .join("\n");
