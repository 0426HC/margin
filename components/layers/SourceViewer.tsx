"use client";

import { AnimatePresence, motion } from "motion/react";
import { useQuietMotion } from "@/lib/lockin/store";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { SourcePage } from "@/lib/layers/source-view";

export interface CiteTarget {
  file: string;
  page: number;
  near?: string;
}

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; view: SourcePage };

/** The cited page of the original file, verbatim, with the cited passage marked. A calm sheet that slides over the right of the workspace. */
export function SourceViewer({ projectId, target, onClose }: { projectId: string; target: CiteTarget | null; onClose: () => void }) {
  const reduced = useQuietMotion();
  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div
            key="scrim"
            className="m-sv-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.08 : 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="sheet"
            className="m-sv"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: reduced ? 0.1 : 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            <Sheet projectId={projectId} start={target} onClose={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Sheet({ projectId, start, onClose }: { projectId: string; start: CiteTarget; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const body = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    document.querySelector<HTMLElement>("[data-sv-close]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // keep Tab inside the sheet while it is open
      if (e.key === "Tab") {
        const els = [...(document.querySelectorAll<HTMLElement>(".m-sv button:not([disabled])"))];
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    let gone = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad({ state: "loading" });
    // the sentence that carried the citation, kept short: a long paragraph would make the address too long, and its opening is enough
    const q = new URLSearchParams({ file: at.file, page: String(at.page), ...(at.near ? { near: at.near.slice(0, 600) } : {}) });
    void fetch(`/api/projects/${projectId}/source?${q}`)
      .then(async (r) => {
        const d = (await r.json()) as SourcePage & { error?: string };
        if (gone) return;
        setLoad(r.ok ? { state: "ready", view: d } : { state: "error", message: d.error ?? "Margin couldn't open that page." });
      })
      .catch(() => !gone && setLoad({ state: "error", message: "Margin lost the connection. Check that the app is still running, then try again." }));
    return () => {
      gone = true;
    };
  }, [projectId, at]);

  // Bring the marked passage into view once the page is there.
  useEffect(() => {
    if (load.state !== "ready") return;
    const el = body.current?.querySelector<HTMLElement>("mark");
    if (el) el.scrollIntoView({ block: "center" });
    else body.current?.scrollTo({ top: 0 });
  }, [load]);

  const view = load.state === "ready" ? load.view : null;
  const unit = view?.pageKind === "slide" ? "Slide" : "Page";
  const go = (page: number) => setAt({ file: at.file, page });

  return (
    <section className="m-sv-sheet m-paper" role="dialog" aria-modal="true" aria-labelledby="sv-title">
      <header className="m-sv-head">
        <div>
          <h2 id="sv-title" className="m-sv-title">
            {at.file}
          </h2>
          <p className="m-sv-page">
            {unit} {at.page}
            {view && view.pageKind !== "virtual" ? ` of ${view.pageCount}` : ""}
          </p>
        </div>
        <Button variant="quiet" onClick={onClose} aria-label="Close the original" data-sv-close>
          Close
        </Button>
      </header>
      <div className="m-sv-body" ref={body} tabIndex={-1}>
        {load.state === "loading" && (
          <p className="m-note" role="status">
            Opening the original…
          </p>
        )}
        {load.state === "error" && (
          <p className="m-note" role="alert">
            {load.message}
          </p>
        )}
        {view && (
          <div className="m-sv-text">
            {view.blocks.map((b, i) => {
              const inner = b.parts.map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : p.text));
              return b.kind === "heading" ? (
                <h3 key={i} className="m-q-head">
                  {inner}
                </h3>
              ) : (
                <p key={i} className={b.kind === "list" ? "m-q-list" : undefined}>
                  {inner}
                </p>
              );
            })}
          </div>
        )}
      </div>
      <footer className="m-sv-foot">
        <Button variant="secondary" onClick={() => go(at.page - 1)} disabled={at.page <= 1 || !view}>
          Previous {unit.toLowerCase()}
        </Button>
        <Button variant="secondary" onClick={() => go(at.page + 1)} disabled={!view || at.page >= view.pageCount}>
          Next {unit.toLowerCase()}
        </Button>
      </footer>
    </section>
  );
}
