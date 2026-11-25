"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CommitSummary, PendingModel } from "./types";

type Choice = { action: "approve" | "merge"; mergeInto: string; title: string; bigQuestion: string };

/** New layers proposed for topics the plan didn't cover. Nothing joins the course until the student approves each one (or adds it to a layer instead). */
export function ProposalStep({
  pending,
  summary,
  busy,
  error,
  onApprove,
  onLater,
}: {
  pending: PendingModel;
  summary: CommitSummary | null;
  busy: boolean;
  error: string | null;
  onApprove: (decisions: { layerId: string; action: "approve" | "merge"; mergeInto?: string; title?: string; bigQuestion?: string }[]) => void;
  onLater: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const get = (id: string, p: PendingModel["proposed"][number]): Choice =>
    choices[id] ?? { action: "approve", mergeInto: pending.layers[0]?.id ?? "", title: p.title, bigQuestion: p.bigQuestion };
  const set = (id: string, p: PendingModel["proposed"][number], patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...get(id, p), ...patch } }));
  const to = summary?.placed.toLayers ?? [];
  return (
    <div className="upd-after">
      {to.length > 0 && (
        <section aria-label="Added to existing layers">
          <h3>Added to layers you already have</h3>
          <ul className="upd-plain">
            {to.map((t) => (
              <li key={t.layerId}>
                {t.title}
                <small>
                  {t.files.join(", ")} · {t.passages} {t.passages === 1 ? "passage" : "passages"} · now shows “New material since you saved”
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary?.placed.fellBack && (
        <p className="upd-lede">Margin couldn’t get a valid plan from Claude for the new material, so it was placed by week instead. Check where it went.</p>
      )}
      {pending.proposed.length > 0 && (
        <section aria-label="New layers to approve">
          <h3>New layers to approve</h3>
          <p className="upd-lede upd-muted">
            These files cover something your week’s layers don’t yet. Rename them, or add the material to a layer you already have. Nothing changes until you
            choose.
          </p>
          <div>
            {pending.proposed.map((p) => {
              const c = get(p.id, p);
              return (
                <div className="upd-layer" key={p.id}>
                  {p.fromLecture && p.weekNumber !== null && <p className="upd-lede">Your Week {p.weekNumber} lecture covers something new: add it as a layer?</p>}
                  <p className="upd-progress">
                    {p.week} · {p.files.join(", ")} · {p.passages} {p.passages === 1 ? "passage" : "passages"}
                  </p>
                  <div className="upd-row-actions">
                    <select
                      className="upd-select"
                      aria-label={`What to do with ${p.title}`}
                      value={c.action}
                      onChange={(e) => set(p.id, p, { action: e.target.value as Choice["action"] })}
                    >
                      <option value="approve">Add as a new layer</option>
                      <option value="merge" disabled={!pending.layers.length}>
                        Add to a layer I have
                      </option>
                    </select>
                    {c.action === "merge" && (
                      <select
                        className="upd-select"
                        aria-label={`Which layer should ${p.title} join`}
                        value={c.mergeInto}
                        onChange={(e) => set(p.id, p, { mergeInto: e.target.value })}
                      >
                        {pending.layers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.week}: {l.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {c.action === "approve" && (
                    <>
                      <input
                        className="m-input"
                        aria-label={`Title of ${p.title}`}
                        value={c.title}
                        maxLength={80}
                        onChange={(e) => set(p.id, p, { title: e.target.value })}
                      />
                      <input
                        className="m-input"
                        aria-label={`Big question of ${p.title}`}
                        value={c.bigQuestion}
                        maxLength={220}
                        onChange={(e) => set(p.id, p, { bigQuestion: e.target.value })}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {error && (
        <p className="m-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="m-dialog-actions">
        <Button onClick={onLater} disabled={busy}>
          Decide later
        </Button>
        <Button
          variant="accent"
          disabled={busy || !pending.proposed.length}
          onClick={() =>
            onApprove(
              pending.proposed.map((p) => {
                const c = get(p.id, p);
                return c.action === "merge"
                  ? { layerId: p.id, action: "merge" as const, mergeInto: c.mergeInto }
                  : { layerId: p.id, action: "approve" as const, title: c.title.trim(), bigQuestion: c.bigQuestion.trim() };
              }),
            )
          }
        >
          {busy ? "Saving…" : "Approve these"}
        </Button>
      </div>
    </div>
  );
}
