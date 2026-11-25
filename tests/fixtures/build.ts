/** Builds tiny real PDF, DOCX and PPTX files for tests, so the parsers run against the real formats. */
import JSZip from "jszip";

export interface PdfLine {
  text: string;
  size?: number;
  /** Extra vertical gap before this line, in points (a paragraph break). */
  gap?: number;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** `author` is written into the PDF's Info dictionary, as a word processor does. */
export function makePdf(pages: PdfLine[][], opts: { author?: string } = {}): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font; then page/content pairs from 4
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    let y = 740;
    let stream = "";
    for (const l of lines) {
      const size = l.size ?? 12;
      y -= size * 1.35 + (l.gap ?? 0);
      if (l.text) stream += `BT /F1 ${size} Tf 72 ${y.toFixed(1)} Td (${esc(l.text)}) Tj ET\n`;
    }
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const infoId = opts.author ? objs.length : 0;
  if (opts.author) objs[infoId] = `<< /Author (${esc(opts.author)}) >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R${infoId ? ` /Info ${infoId} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface DocxPara {
  text: string;
  /** 1-6 for Heading 1-6 */
  heading?: number;
  bullet?: boolean;
}

/** The document's properties (docProps/core.xml), where Word and PowerPoint keep who wrote the file. */
const coreProps = (author: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${xmlEsc(author)}</dc:creator><cp:lastModifiedBy>${xmlEsc(author)}</cp:lastModifiedBy></cp:coreProperties>`;

export async function makeDocx(paras: DocxPara[], opts: { author?: string } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (opts.author) zip.file("docProps/core.xml", coreProps(opts.author));
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
  );
  const styles = [1, 2, 3, 4, 5, 6]
    .map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`)
    .join("");
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles}</w:styles>`,
  );
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  const body = paras
    .map((p) => {
      const ppr = p.heading
        ? `<w:pPr><w:pStyle w:val="Heading${p.heading}"/></w:pPr>`
        : p.bullet
          ? `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`
          : "";
      return `<w:p>${ppr}<w:r><w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
    })
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

export interface PptxSlide {
  title?: string;
  bullets?: string[];
}

/** Slides are written to files in `fileOrder` (default: in order), and listed in presentation order. */
export async function makePptx(slides: PptxSlide[], fileOrder?: number[], opts: { author?: string } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (opts.author) zip.file("docProps/core.xml", coreProps(opts.author));
  const order = fileOrder ?? slides.map((_, i) => i);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${order[i] + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  slides.forEach((s, i) => {
    const title = s.title
      ? `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${xmlEsc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>`
      : "";
    const bullets = (s.bullets ?? []).length
      ? `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${(s.bullets ?? [])
          .map((b) => `<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>${xmlEsc(b)}</a:t></a:r></a:p>`)
          .join("")}</p:txBody></p:sp>`
      : "";
    zip.file(
      `ppt/slides/slide${order[i] + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${title}${bullets}</p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: "uint8array" });
}
