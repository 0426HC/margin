"use client";

import { splitCitations } from "@/lib/ai/citations";
import type { QuestionOrigin } from "@/lib/exam/types";

const KIND: Record<QuestionOrigin["kind"], string> = { sheet: "your exam sheet", past: "a past exam", lecture: "the lecture", reading: "your reading" };

/** What a question was built from, in words, with its citation. A reading or lecture citation opens the page; a sheet or past exam has no page to open. */
export function Origins({ origins, onCite }: { origins: QuestionOrigin[]; onCite: (page: number, file: string) => void }) {
  return (
    <p className="ex-origin">
      <span>Built from </span>
      {origins.map((o, i) => (
        <span key={i}>
          {i > 0 && "; "}
          {o.label || KIND[o.kind]}{" "}
          {splitCitations(o.cite).map((p, k) =>
            "cite" in p ? (
              o.kind === "reading" || o.kind === "lecture" ? (
                <button key={k} type="button" className="m-cite-inline" onClick={() => onCite(p.cite.page, p.cite.file)} aria-label={`${p.cite.file}, page ${p.cite.page}. Show the original page`}>
                  {p.cite.raw}
                </button>
              ) : (
                <span key={k} className="ex-cite">
                  {p.cite.raw}
                </span>
              )
            ) : null,
          )}
        </span>
      ))}
    </p>
  );
}
