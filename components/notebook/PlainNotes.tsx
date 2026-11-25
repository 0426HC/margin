"use client";

import { useRouter } from "next/navigation";
import { useState, type RefObject } from "react";
import type { GuideWeek } from "@/lib/layers/note-to-self";
import { CondensedField } from "./QuickNote";
import { WriteEntry, type Saved } from "./WriteEntry";

/**
 * Note to Self in lock in: no book. The condensed notes on the left, a thin line, then every saved write-up flowing in course order, each
 * with its layer's name. The two columns scroll on their own, so one can be read while writing in the other. Nothing moves.
 */
export function PlainNotes({ projectId, weeks, condensed, pagesRef }: { projectId: string; weeks: GuideWeek[]; condensed: string; pagesRef: RefObject<HTMLDivElement | null> }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set()); // entries just deleted, hidden at once while the page reloads its data
  const saved = weeks.flatMap((p) => [...p.layers, p.synthesis]).filter((s): s is Saved => !!s.final && !gone.has(s.id));
  const removed = (id: string) => {
    setGone((g) => new Set(g).add(id));
    router.refresh();
  };
  return (
    <div className="lk-nts-pages" ref={pagesRef}>
      <h1 className="sr-only">Note to Self</h1>
      <section className="lk-nts-col" data-col="condensed" aria-label="Condensed notes" tabIndex={-1}>
        <div className="lk-nts-entry lk-nts-condensed">
          <p className="lk-nts-label" aria-hidden="true">
            <span>Condensed notes</span>
          </p>
          <CondensedField projectId={projectId} initial={condensed} minHeight={320} />
        </div>
      </section>
      <div className="lk-nts-rule" aria-hidden="true" />
      <section className="lk-nts-col" data-col="write-ups" aria-label="Your saved write-ups" tabIndex={-1}>
        {saved.length ? (
          saved.map((s) => <WriteEntry key={s.id} projectId={projectId} slot={s} look="plain" onRemoved={() => removed(s.id)} />)
        ) : (
          <p className="lk-nts-empty">Nothing is in Note to Self yet. After a layer&rsquo;s review, choose &ldquo;Yes, my own writing&rdquo; or &ldquo;Yes, refined version&rdquo; and it appears here.</p>
        )}
      </section>
    </div>
  );
}
