"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { StructureLayer, StructureModel, StructureWeek } from "@/lib/layers/types";
import type { PlanExtras } from "@/lib/projects/plan-page";
import { courseTitle } from "@/lib/projects/title";
import { call } from "./api";
import { FilesPanel } from "./FilesPanel";
import { QuestionCard } from "./QuestionCard";
import { SortFiles } from "./SortFiles";
import { WeekCountField } from "./WeekCountField";
import { SetupBar } from "@/components/import/SetupBar";

const fmt = (n: number) => n.toLocaleString("en-US");
type Run = (f: () => Promise<string | null>) => void;

function LayerRow({ layer, index, week, weeks, projectId, run }: { layer: StructureLayer; index: number; week: StructureWeek; weeks: StructureWeek[]; projectId: string; run: Run }) {
  const [title, setTitle] = useState(layer.title);
  const [question, setQuestion] = useState(layer.bigQuestion);
  const edit = (body: object) => run(() => call(`/api/projects/${projectId}/structure`, "PATCH", { layerId: layer.id, ...body }));
  const withLayers = weeks.filter((w) => w.layers.length);
  const wi = withLayers.findIndex((w) => w.week === week.week);
  const first = index === 0;
  const last = index === week.layers.length - 1;
  const before = withLayers[wi - 1];
  const after = withLayers[wi + 1];
  const upLabel = first && before ? `Move to week ${before.week}` : "Move up";
  const downLabel = last && after ? `Move to week ${after.week}` : "Move down";
  const no = `${week.week}.${index + 1}`;
  return (
    <li className="m-layer m-gutter-row" data-layer-id={layer.id}>
      <div className="m-layer-no">
        <div>{no}</div>
      </div>
      <div className="min-w-0">
        <input
          className="m-unit-title"
          aria-label={`Title of layer ${no}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim();
            if (!t) setTitle(layer.title);
            else if (t !== layer.title) edit({ op: "update", title: t });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {layer.optional && <p className="m-layer-tag">Optional layer</p>}
        <textarea
          className="m-layer-q"
          rows={1}
          aria-label={`Big question of layer ${no}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => {
            const q = question.trim();
            if (!q) setQuestion(layer.bigQuestion);
            else if (q !== layer.bigQuestion) edit({ op: "update", bigQuestion: q });
          }}
        />
        {layer.buildsOn && <p className="m-layer-builds">{layer.buildsOn}</p>}
        <p className="m-sheet-meta" style={{ marginTop: 6, whiteSpace: "normal" }}>
          {fmt(layer.words)} words · about {layer.minutes} min · from {layer.sources.map((s) => s.file).join(", ")}
          {layer.extras.length > 0 && ` · optional: ${layer.extras.join(", ")}`}
        </p>
        <div className="m-layer-actions">
          <Button variant="quiet" disabled={first && !before} onClick={() => edit({ op: "move", direction: "up" })} aria-label={`${upLabel}: ${layer.title}`}>
            {upLabel}
          </Button>
          <Button variant="quiet" disabled={last && !after} onClick={() => edit({ op: "move", direction: "down" })} aria-label={`${downLabel}: ${layer.title}`}>
            {downLabel}
          </Button>
          <Button variant="quiet" disabled={last} onClick={() => edit({ op: "merge" })} aria-label={`Merge ${layer.title} with the next layer`}>
            Merge with next
          </Button>
          <Button variant="quiet" disabled={layer.passages < 2} onClick={() => edit({ op: "split" })} aria-label={`Split ${layer.title} in two`}>
            Split in two
          </Button>
          {weeks.length > 1 && (
            <label className="m-layer-moveto">
              <span className="sr-only">Move {layer.title} to another week</span>
              <select className="m-select" value="" onChange={(e) => e.target.value && edit({ op: "moveToWeek", week: Number(e.target.value) })}>
                <option value="">Move to week…</option>
                {weeks
                  .filter((w) => w.week !== week.week)
                  .map((w) => (
                    <option key={w.week} value={w.week}>
                      {w.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </li>
  );
}

function WeekBlock({ week, weeks, projectId, run }: { week: StructureWeek; weeks: StructureWeek[]; projectId: string; run: Run }) {
  const minutes = Math.max(1, Math.round(week.words / 230));
  const reading = minutes < 90 ? `about ${minutes} min` : `about ${Math.round(minutes / 6) / 10} hours`;
  return (
    <section className="m-part" aria-label={week.label} data-week={week.week}>
      <div className="m-gutter-row">
        <span className="m-margin-note" />
        <div className="min-w-0">
          <h2 className="m-part-key">{week.label}</h2>
          <p className="m-part-span">
            {week.layers.length ? (
              <>
                {week.layers.length} {week.layers.length === 1 ? "layer" : "layers"} · {reading} of reading
              </>
            ) : (
              "Material not added yet"
            )}
          </p>
        </div>
      </div>
      {week.layers.length > 0 && (
        <ol className="m-layers">
          {week.layers.map((l, i) => (
            <LayerRow key={`${l.id}:${l.title}:${l.bigQuestion}:${week.week}`} layer={l} index={i} week={week} weeks={weeks} projectId={projectId} run={run} />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The one review screen: what Margin read, the number of weeks, the files with their weeks and types, and the layers it proposes for
 * each week. Everything is already filled in; editing is optional. "Looks good" approves the whole plan. Nothing is written until then.
 */
export function LayerPlan({ model, extras }: { model: StructureModel; extras: PlanExtras }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmingAgain, setConfirmingAgain] = useState(false);
  const started = useRef(false);
  // the plan call in flight: Cancel, Esc or leaving the page aborts it, which stops the AI call on the server too
  const drafting = useRef<AbortController | null>(null);
  const stop = useCallback(() => {
    drafting.current?.abort();
    drafting.current = null;
    setProposing(false);
  }, []);
  useEffect(
    () => () => {
      drafting.current?.abort();
      started.current = false; // mounted again (Strict Mode does this once in development): propose again
    },
    [],
  );
  const { project, weeks } = model;
  const planned = weeks.some((w) => w.layers.length > 0);
  const allApproved = planned && weeks.every((w) => w.status === "approved");
  const title = courseTitle(project.name, project.courseCode);

  function run(f: () => Promise<string | null>) {
    void f().then((err) => {
      setError(err);
      if (!err) router.refresh();
    });
  }

  async function propose() {
    setProposing(true);
    setError(null);
    setConfirmingAgain(false);
    const ctl = new AbortController();
    drafting.current = ctl;
    const err = await call(`/api/projects/${project.id}/structure/propose`, "POST", undefined, ctl.signal);
    if (ctl.signal.aborted) return;
    drafting.current = null;
    setProposing(false);
    if (err) setError(err);
    else router.refresh();
  }

  async function looksGood() {
    setApproving(true);
    setError(null);
    const err = await call(`/api/projects/${project.id}/structure/approve`, "POST", {});
    setApproving(false);
    if (err) setError(err);
    else router.push(`/p/${project.id}`);
  }

  // the plan is proposed on its own as soon as Margin has what it needs: no button to find
  useEffect(() => {
    if (started.current || planned || extras.askWeekCount || extras.failed) return;
    started.current = true;
    void propose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, extras.askWeekCount, extras.failed]);

  const action = allApproved ? (
    <Button variant="primary" size="lg" onClick={() => router.push(`/p/${project.id}`)}>
      Open the course
    </Button>
  ) : (
    <Button variant="primary" size="lg" onClick={() => void looksGood()} disabled={approving || proposing || !planned}>
      {approving ? "Opening the course" : "Looks good"}
    </Button>
  );

  return (
    <div>
      {!project.isDemo && <SetupBar projectId={allApproved ? null : project.id} projectName={project.name} onStop={stop} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="t-label text-panel-muted">{title}</p>
          <h1 className="t-h1 mt-1">Your course plan</h1>
          <p className="t-body mt-2 max-w-[62ch] text-panel-muted">
            Margin read {extras.summary.charAt(0).toLowerCase() + extras.summary.slice(1)}{" "}
            {planned ? "Here are the ideas of each week, in the order they build. Change anything you like, or just press Looks good. Nothing is written until you do." : ""}
          </p>
        </div>
        {planned && action}
      </div>

      {error && (
        <p className="m-field-error mt-4 max-w-[62ch]" role="alert">
          {error}
        </p>
      )}

      {extras.failed && !planned && (
        <section className="m-question" aria-label="The files aren't sorted">
          <h2 className="m-question-q">The files aren&rsquo;t sorted into weeks yet</h2>
          <p className="m-question-why">
            {extras.failed} Give each file its week and type in the list below, then press Suggest the layers. Or ask Claude to sort them again.
          </p>
          <SortFiles projectId={project.id} />
        </section>
      )}

      {extras.askWeekCount && <QuestionCard projectId={project.id} onAnswered={() => (started.current = false)} />}

      {model.note && planned && (
        <p className="m-layer-warn mt-4 max-w-[62ch]" role="status" style={{ color: "var(--panel-ink)" }}>
          {model.note}
        </p>
      )}

      {proposing && (
        <p role="status" className="t-ui mt-6 text-panel-muted">
          Reading each week and proposing its layers. This takes a few minutes.
        </p>
      )}

      {!extras.askWeekCount && (
        <Surface kind="paper" raised className="m-plan-facts mt-8 px-10 py-6">
          <WeekCountField projectId={project.id} weekCount={extras.weekCount} />
          <details className="m-files-details" open={!!extras.failed || extras.unlabelled > 0 || undefined}>
            <summary>
              Files, weeks and types
              <span className="m-files-count">
                {" "}
                · {extras.files.length} files
                {extras.check ? `, ${extras.check} to check` : ""}
                {extras.unlabelled ? `, ${extras.unlabelled} not labelled` : ""}
                {extras.notInSyllabus ? `, ${extras.notInSyllabus} not in the syllabus` : ""}
              </span>
            </summary>
            <FilesPanel projectId={project.id} files={extras.files} weekCount={extras.weekCount ?? 0} />
          </details>
          {extras.review.length > 0 && (
            <details className="m-files-details">
              <summary>
                What the final check noticed
                <span className="m-files-count"> · {extras.review.length}</span>
              </summary>
              <ul className="m-missing">
                {extras.review.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
          {extras.missingReadings.length > 0 && (
            <details className="m-files-details">
              <summary>
                Readings in the syllabus that aren&rsquo;t in the folder
                <span className="m-files-count"> · {extras.missingReadings.length}</span>
              </summary>
              <p className="t-ui mt-2 text-ink-muted">Claude couldn&rsquo;t match these to any file. Add them with Add files if you have them.</p>
              <ul className="m-missing">
                {extras.missingReadings.map((r, i) => (
                  <li key={i}>
                    <span className="m-missing-week">{r.week ? `Week ${r.week}` : "No week"}</span>
                    {r.reading}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Surface>
      )}

      {!planned && !proposing && !extras.askWeekCount && (
        <div className="mt-8">
          <Button variant="primary" size="lg" onClick={() => void propose()}>
            Suggest the layers
          </Button>
        </div>
      )}

      {planned && (
        <>
          <Surface kind="paper" raised className="mt-6 px-10 py-9">
            {weeks.map((w) => (
              <WeekBlock key={`${w.week}:${w.id}`} week={w} weeks={weeks} projectId={project.id} run={run} />
            ))}
          </Surface>
          {model.looseOptional.length > 0 && (
            <Surface kind="paper" raised className="mt-6 px-10 py-6">
              <h2 className="t-h3">Optional readings on a topic of their own</h2>
              <p className="t-ui mt-1 text-ink-muted">No required reading covers these, so each is attached to the closest layer for now. Make one its own optional layer if you want to study it.</p>
              <ul className="m-loose">
                {model.looseOptional.map((o) => (
                  <li key={o.fileId}>
                    <span className="m-file-name">{o.name}</span>
                    {o.layerTitle && <span className="m-file-path"> · attached to {o.layerTitle}</span>}
                    <Button variant="quiet" onClick={() => run(() => call(`/api/projects/${project.id}/structure`, "PATCH", { op: "addOptional", fileId: o.fileId }))}>
                      Add as optional layer
                    </Button>
                  </li>
                ))}
              </ul>
            </Surface>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {action}
            {!weeks.some((w) => w.id && w.status === "approved") &&
              (confirmingAgain ? (
                <>
                  <span className="t-ui">Replace this plan, including your edits?</span>
                  <Button onClick={() => void propose()} disabled={proposing}>
                    Yes, suggest again
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmingAgain(false)}>
                    Keep this plan
                  </Button>
                </>
              ) : (
                <Button variant="quiet" onClick={() => setConfirmingAgain(true)} disabled={proposing}>
                  Suggest the layers again
                </Button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
