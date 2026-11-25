"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuideWeek } from "@/lib/layers/note-to-self";
import { CondensedField, SAVE_WORD } from "./QuickNote";
import { WriteEntry, type Saved } from "./WriteEntry";

export { SAVE_WORD };

/**
 * The open book. The left page is always the condensed notes: one page of the project's own, there and editable even before anything is
 * saved, the same page as lock in's left column; it stays in view while the write-ups scroll past. The right page is every saved write-up
 * (layers and week syntheses) in course order, each editable in place and deletable with Undo; a layer's older quick notes sit under its
 * write-up. Only my own words are printed on the paper: no headings, no dividers.
 */
export function Notebook({ projectId, weeks, condensed }: { projectId: string; weeks: GuideWeek[]; condensed: string }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set()); // entries just deleted, hidden at once while the page reloads its data
  const removed = (id: string) => {
    setGone((g) => new Set(g).add(id));
    router.refresh();
  };
  const saved = weeks.flatMap((p) => [...p.layers, p.synthesis]).filter((s): s is Saved => !!s.final && !gone.has(s.id));
  return (
    <div className="nb-row nb-condensed">
      <div className="nb-l">
        <CondensedField projectId={projectId} initial={condensed} minHeight={360} />
      </div>
      <div className="nb-cwrites">
        {saved.map((s) => (
          <WriteEntry key={s.id} projectId={projectId} slot={s} look="book" onRemoved={() => removed(s.id)} />
        ))}
      </div>
    </div>
  );
}
