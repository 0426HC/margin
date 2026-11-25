import { Fragment } from "react";
import { splitCitations } from "@/lib/ai/citations";

/** Opens the source at a page. `near` is the sentence that carried the citation; it picks which passage on the page to mark. */
export type CiteHandler = (page: number, file: string, near?: string) => void;

/** Text with its [file, p. N] citations turned into buttons. A click opens the source at that page. */
export function CitedText({ text, onCite }: { text: string; onCite: CiteHandler }) {
  const near = splitCitations(text).map((p) => ("text" in p ? p.text : "")).join("");
  return (
    <>
      {splitCitations(text).map((p, i) =>
        "cite" in p ? (
          <button
            key={i}
            type="button"
            className="m-cite-inline"
            onClick={() => onCite(p.cite.page, p.cite.file, near)}
            aria-label={`${p.cite.file}, page ${p.cite.page}. Show the original page`}
          >
            {p.cite.raw}
          </button>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
