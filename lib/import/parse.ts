import { ImportError } from "./errors";
import { fileKindOf, unsupportedMessage } from "./kinds";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";
import { parsePptx } from "./parse-pptx";
import { parseText } from "./parse-text";
import type { ParsedFile } from "./types";

export { fileKindOf, ImportError };

export async function parseFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  const kind = fileKindOf(name);
  if (!kind) {
    throw new ImportError(unsupportedMessage(name));
  }
  if (kind === "pdf") return parsePdf(bytes);
  if (kind === "docx") return parseDocx(bytes);
  if (kind === "pptx") return parsePptx(bytes);
  return parseText(kind, bytes);
}
