import type { ReactNode } from "react";

export type MarginMark =
  | { kind: "page"; page: number; /** The Source tab names the file beside the page. */ file?: string }
  | { kind: "cite"; page: number; file: string; onJump: (page: number, file: string, near?: string) => void; near?: string };

/**
 * The margin: the product's signature detail. Page markers sit beside the Original, and citations
 * beside the Explained text. A citation jumps to the matching page marker in Original.
 */
export function MarginGutter({ marks }: { marks: MarginMark[] }) {
  return (
    <div className="m-gutter">
      {marks.map((m) =>
        m.kind === "page" ? (
          <span key={`${m.file ?? ""}:${m.page}`} className="m-page-marker" data-has-file={m.file ? "" : undefined}>
            <span>p. {m.page}</span>
            {m.file && <span className="m-page-file" title={m.file}>{m.file}</span>}
          </span>
        ) : (
          <button
            key={`${m.file}:${m.page}`}
            type="button"
            className="m-cite"
            onClick={() => m.onJump(m.page, m.file, m.near)}
            aria-label={`[${m.file}, p. ${m.page}]. Show this page of the original`}
            title={`${m.file}, p. ${m.page}`}
          >
            <span>p. {m.page}</span>
          </button>
        ),
      )}
    </div>
  );
}

/** One paragraph of text with its margin. `firstOnPage` lets the reading pane scroll to a page. */
export function MarginRow({
  marks,
  kind,
  firstOnPage,
  flash,
  children,
}: {
  marks: MarginMark[];
  kind?: string;
  firstOnPage?: number;
  flash?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="m-row" data-kind={kind} data-page-first={firstOnPage} data-flash={flash ? "" : undefined}>
      <MarginGutter marks={marks} />
      {children}
    </div>
  );
}
