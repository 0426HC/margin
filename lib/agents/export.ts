import JSZip from "jszip";
import type { AgentDocBlock, AgentDocument } from "./types";

/** Download formats for a document an agent made: Word (.docx) and PDF, built here with no extra service and nothing leaving the computer. */

const AGENT: Record<AgentDocument["agent"], string> = {
  explainer: "the Explainer",
  quizzer: "the Quizzer",
  examiner: "the Examiner",
  connector: "the Connector",
  librarian: "the Librarian",
};
const footer = (d: AgentDocument) => `Made by ${AGENT[d.agent]} in Margin from your own course files and writing. Citations are [file, p. N].`;

/** The document as plain lines with a kind, so both formats say the same thing. */
function lines(d: AgentDocument): { kind: "title" | "heading" | "text" | "bullet" | "small"; text: string }[] {
  const out: { kind: "title" | "heading" | "text" | "bullet" | "small"; text: string }[] = [{ kind: "title", text: d.title }];
  for (const b of d.blocks as AgentDocBlock[]) {
    if (b.type === "heading") out.push({ kind: "heading", text: b.text });
    else if (b.type === "paragraph") out.push({ kind: "text", text: b.text });
    else for (const i of b.items) out.push({ kind: "bullet", text: i });
  }
  out.push({ kind: "small", text: footer(d) });
  return out;
}

export const safeFileName = (title: string) =>
  title
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "margin-document";

// ---------------------------------------------------------------- Word

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;

export async function toDocx(d: AgentDocument): Promise<Uint8Array> {
  const body = lines(d)
    .map((l) => {
      if (l.kind === "title") return `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${run(l.text, { bold: true, size: 40 })}</w:p>`;
      if (l.kind === "heading") return `<w:p><w:pPr><w:spacing w:before="280" w:after="80"/></w:pPr>${run(l.text, { bold: true, size: 28 })}</w:p>`;
      if (l.kind === "bullet")
        return `<w:p><w:pPr><w:ind w:left="500" w:hanging="260"/><w:spacing w:after="80"/></w:pPr>${run(`•\t${l.text}`, { size: 22 })}</w:p>`;
      if (l.kind === "small") return `<w:p><w:pPr><w:spacing w:before="360"/></w:pPr>${run(l.text, { size: 18, color: "555555" })}</w:p>`;
      return `<w:p><w:pPr><w:spacing w:after="140"/></w:pPr>${run(l.text, { size: 22 })}</w:p>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

// ---------------------------------------------------------------- PDF

/** Text in the PDF's own encoding (Latin-1): typographic marks become plain ones, and anything outside Latin-1 becomes "?". */
export function winAnsi(t: string): string {
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/→/g, "->")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, "?");
}
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Greedy word wrap by an average Helvetica glyph width (a little wide, so lines never run off the page). */
function wrap(text: string, size: number, width: number): string[] {
  const per = size * 0.54;
  const max = Math.max(10, Math.floor(width / per));
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
    while (line.length > max) {
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

export function toPdf(d: AgentDocument): Uint8Array {
  const W = 612;
  const H = 792;
  const M = 72;
  const style = {
    title: { size: 20, bold: true, gap: 14, after: 8 },
    heading: { size: 14, bold: true, gap: 12, after: 3 },
    text: { size: 11, bold: false, gap: 0, after: 6 },
    bullet: { size: 11, bold: false, gap: 0, after: 3 },
    small: { size: 8.5, bold: false, gap: 14, after: 0 },
  } as const;
  const pages: string[][] = [[]];
  let y = H - M;
  const put = (text: string, size: number, bold: boolean, x: number) => {
    if (y - size < M) {
      pages.push([]);
      y = H - M;
    }
    pages[pages.length - 1].push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y.toFixed(1)} Td (${esc(winAnsi(text))}) Tj ET`);
    y -= size * 1.35;
  };
  for (const l of lines(d)) {
    const st = style[l.kind];
    y -= st.gap;
    const indent = l.kind === "bullet" ? 18 : 0;
    const rows = wrap(l.kind === "bullet" ? l.text : l.text, st.size, W - 2 * M - indent);
    rows.forEach((r, i) => put(i === 0 && l.kind === "bullet" ? `- ${r}` : r, st.size, st.bold, M + indent + (l.kind === "bullet" && i > 0 ? 8 : 0)));
    y -= st.after;
  }
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((p, i) => {
    const content = p.join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
    objs[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
