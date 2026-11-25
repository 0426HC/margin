"use client";

import { ReadMark } from "@/components/overview/ReadMark";
import Link from "next/link";
import type { SceneWeek } from "@/components/overview/Scene";
import { rowStatus, ROW_WORD, upNext, type RowStatus } from "@/lib/lockin/plain";
import { tabHref } from "@/lib/overview/tabs";

/**
 * The Layers tab in lock in: one plain screen. What to do next, then every week with its layers as rows and their status (the places
 * beside the weeks are tabs of their own). A week whose material hasn't been added yet says so. Nothing moves and nothing is drawn; every status has a word as well as a mark.
 */
export function PlainOverview({ projectId, title, weekScenes, resume }: { projectId: string; title: string; weekScenes: SceneWeek[]; resume: { layerId: string; title: string } | null }) {
  const next = upNext(resume);
  const where = resume ? placeOf(weekScenes, resume.layerId) : null;
  const href = (id: string) => `/p/${projectId}/l/${id}`;
  return (
    <main className="lk-ov" aria-label="Layers">
      {/* the top bar already shows the course; the page still needs its one main heading */}
      <h1 className="sr-only">{title}</h1>
      <section className="lk-next" aria-labelledby="lk-next-h">
        <h2 id="lk-next-h" className="lk-next-label">
          Up next
        </h2>
        <p className="lk-next-line">{next.line}</p>
        {where && <p className="lk-next-where">{where}</p>}
        {next.layerId ? (
          <Link href={href(next.layerId)} className="lk-primary">
            Continue
          </Link>
        ) : (
          <Link href={tabHref(projectId, "note-to-self")} className="lk-primary">
            Open Note to Self
          </Link>
        )}
      </section>

      {weekScenes.map((p) => {
        const saved = p.layers.filter((l) => l.state === "saved").length;
        if (!p.layers.length)
          return (
            <section key={p.id} className="lk-part" aria-labelledby={`lk-part-${p.id}`}>
              <header className="lk-part-head">
                <h2 id={`lk-part-${p.id}`}>{p.name}</h2>
              </header>
              <p className="lk-empty">Material not added yet</p>
            </section>
          );
        return (
          <section key={p.id} className="lk-part" aria-labelledby={`lk-part-${p.id}`}>
            <header className="lk-part-head">
              <h2 id={`lk-part-${p.id}`}>
                {p.name}
                {p.read && <ReadMark />}
              </h2>
              <span className="lk-count" aria-label={`${saved} of ${p.layers.length} layers saved`}>
                {saved}/{p.layers.length}
              </span>
            </header>
            <ol className="lk-rows">
              {p.layers.map((l, i) => {
                const st = rowStatus(l);
                return (
                  <li key={l.id}>
                    <Link href={href(l.id)} className="lk-row">
                      <span className="lk-row-n" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="lk-row-title">{l.title}</span>
                      <Status s={st} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

    </main>
  );
}

function Status({ s }: { s: RowStatus }) {
  return (
    <span className="lk-status" data-state={s}>
      <i aria-hidden="true" />
      {ROW_WORD[s]}
    </span>
  );
}

/** "Week 3 · The Constitution, layer 2 of 6", for the Up next box. */
function placeOf(weekScenes: SceneWeek[], layerId: string) {
  for (const p of weekScenes) {
    const i = p.layers.findIndex((l) => l.id === layerId);
    if (i >= 0) return `${p.name}, layer ${i + 1} of ${p.layers.length}`;
  }
  return null;
}
