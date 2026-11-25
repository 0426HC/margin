export type BlockKind = "heading" | "paragraph" | "list";

/** One piece of a file's text, exactly as written, with the page or slide it sits on. */
export interface Block {
  kind: BlockKind;
  text: string;
  /** Page (PDF), slide (PPTX) or a virtual page of about 400 words (DOCX, TXT, MD). */
  page: number;
  /** Headings only: 1 is the largest. */
  level?: number;
}

export type FileKind = "pdf" | "docx" | "pptx" | "txt" | "md";
export type PageKind = "page" | "slide" | "virtual";
/** What a file is for: lecture slides, a reading, or an exam instruction sheet. */
export type FileRole = "lecture" | "reading" | "exam";

export interface ParsedFile {
  kind: FileKind;
  pageKind: PageKind;
  pageCount: number;
  blocks: Block[];
  /** Running headers and footers lifted out of the text, kept for the margin. */
  runningHeaders: string[];
  /** PDFs only: 0 to 1, how much of the text looks like real words. Low means noisy or scanned. */
  textQuality?: number;
  /** Who the file's own properties say wrote it (PDF Author, Word or PowerPoint creator), when they say. */
  author?: string | null;
  /** PDFs only: how far the printed page numbers run ahead of the PDF's own (6 when PDF page 1 is printed p. 7). Null when none are found. */
  printedOffset?: number | null;
}

export interface RawLine {
  text: string;
  /** Font size, when the source has one (PDF). */
  size?: number;
  /** Set by the parser when the line is typographically or structurally a heading. */
  heading?: number;
}

export interface RawPage {
  page: number;
  /** An empty text line means a paragraph break. */
  lines: RawLine[];
}

export interface Section {
  title: string;
  blocks: Block[];
  pageStart: number;
  pageEnd: number;
  wordCount: number;
}

export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);
