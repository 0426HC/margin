import type { FileKind } from "./types";

const KINDS: Record<string, FileKind> = { pdf: "pdf", docx: "docx", pptx: "pptx", txt: "txt", md: "md", markdown: "md" };

export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", txt: "Text", md: "Markdown" };

export const fileKindOf = (name: string): FileKind | undefined => KINDS[name.split(".").pop()?.toLowerCase() ?? ""];

export function unsupportedMessage(name: string): string {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "This file";
  return `${ext} isn't a type Margin reads. Use PDF, Word (.docx), PowerPoint (.pptx), .txt or .md.`;
}

/** Files the operating system or Office creates behind the scenes. They are skipped without comment. */
export const isJunkFile = (name: string) => name.startsWith(".") || name.startsWith("~$");
