import { Fragment, type ReactNode } from "react";
import { CitedText, type CiteHandler } from "./Citation";

/**
 * A small, safe markdown for chat replies: **bold**, *italic*, `code`, bullet and numbered lists, # headings and line breaks.
 * It builds React elements (never HTML), and [file, p. N] citations inside any of it still become buttons.
 * A mark that is not closed yet (while an answer streams in) stays as plain text until its partner arrives.
 */
const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`|(?<![*\w])\*[^*\s][^*\n]*?\*(?![*\w])|(?<![\w_])_[^_\s][^_\n]*?_(?![\w_]))/;

function inline(text: string, onCite: CiteHandler, key = "i"): ReactNode[] {
  return text.split(INLINE).map((piece, i) => {
    const k = `${key}${i}`;
    if (i % 2 === 0) return piece ? <CitedText key={k} text={piece} onCite={onCite} /> : null;
    if (piece.startsWith("**")) return <strong key={k}>{inline(piece.slice(2, -2), onCite, k)}</strong>;
    if (piece.startsWith("`")) return <code key={k}>{piece.slice(1, -1)}</code>;
    return <em key={k}>{inline(piece.slice(1, -1), onCite, k)}</em>;
  });
}

type Block = { type: "p"; lines: string[] } | { type: "ul" | "ol"; items: string[] } | { type: "h"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
    const last = out.at(-1);
    if (!line.trim()) out.push({ type: "p", lines: [] }); // a blank line ends the paragraph or list
    else if (heading) out.push({ type: "h", text: heading[1] });
    else if (bullet || number) {
      const kind = bullet ? "ul" : "ol";
      if (last && last.type === kind) last.items.push((bullet ?? number)![1]);
      else out.push({ type: kind, items: [(bullet ?? number)![1]] });
    } else if (last && last.type === "p" && last.lines.length) last.lines.push(line);
    else if (last && last.type === "p" && !last.lines.length) last.lines.push(line);
    else out.push({ type: "p", lines: [line] });
  }
  return out.filter((b) => b.type !== "p" || b.lines.length);
}

export function Markdown({ text, onCite }: { text: string; onCite: CiteHandler }) {
  return (
    <div className="m-md">
      {blocks(text).map((b, i) => {
        if (b.type === "h") return <p key={i} className="m-md-h"><strong>{inline(b.text, onCite, `h${i}`)}</strong></p>;
        if (b.type === "p")
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l, onCite, `p${i}-${j}-`)}
                </Fragment>
              ))}
            </p>
          );
        const List = b.type;
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, onCite, `l${i}-${j}-`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
