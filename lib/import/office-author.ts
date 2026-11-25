import type JSZip from "jszip";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The author a Word or PowerPoint file names in its properties (docProps/core.xml): its creator, else whoever last saved it. */
export async function officeAuthor(zip: JSZip): Promise<string | null> {
  const core = await zip.file("docProps/core.xml")?.async("string");
  if (!core) return null;
  const field = (tag: string) => decode(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(core)?.[1] ?? "").trim();
  return cleanAuthor(field("dc:creator") || field("cp:lastModifiedBy"));
}

/** An author name as worth showing: trimmed and short, or null when empty. */
export const cleanAuthor = (s: string | null | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t || null;
};
