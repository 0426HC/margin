"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { StructureLayer, StructureModel, StructurePart } from "@/lib/layers/types";

const fmt = (n: number) => n.toLocaleString("en-US");

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!r) return "Margin lost the connection. Check that the app is still running, then try again.";
  if (r.ok) return null;
  return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="6" cy="6" r="4.6" />
      <path d="M3.9 6.2l1.4 1.4 2.8-3.1" />
    </svg>
  );
}

function LayerRow({ layer, index, part, projectId, run }: { layer: StructureLayer; index: number; part: StructurePart; projectId: string; run: (f: () => Promise<string | null>) => void }) {
  const [title, setTitle] = useState(layer.title);
  const [question, setQuestion] = useState(layer.bigQuestion);
  const edit = (body: object) => run(() => call(`/api/projects/${projectId}/structure`, "PATCH", { layerId: layer.id, ...body }));
  const first = index === 0;
  const last = index === part.layers.length - 1;
  const isFirstOverall = part.key === "A" && first;
  const isLastOverall = part.key === "B" && last;
  const upLabel = first && part.key === "B" ? "Move to Part A" : "Move up";
  const downLabel = last && part.key === "A" ? "Move to Part B" : "Move down";
  const sources = layer.sources;
  return (
    <li className="m-layer m-gutter-row" data-layer-id={layer.id}>
      <div className="m-layer-no">
        <div>{part.key}{index + 1}</div>
        {sources.length === 1 ? <div title={sources[0].file}>{sources[0].pages}</div> : <div>{sources.length} files</div>}
      </div>
      <div className="min-w-0">
        <input
          className="m-unit-title"
          aria-label={`Title of layer ${part.key}${index + 1}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim();
            if (!t) setTitle(layer.title);
            else if (t !== layer.title) edit({ op: "update", title: t });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <textarea
          className="m-layer-q"
          rows={1}
          aria-label={`Big question of layer ${part.key}${index + 1}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => {
            const q = question.trim();
            if (!q) setQuestion(layer.bigQuestion);
            else if (q !== layer.bigQuestion) edit({ op: "update", bigQuestion: q });
          }}
        />
        {layer.buildsOn && <p className="m-layer-builds">{layer.buildsOn}</p>}
        <p className="m-sheet-meta" style={{ marginTop: 6 }}>
          {fmt(layer.words)} words · about {layer.minutes} min · from {layer.sources.map((s) => s.file).join(", ")}
        </p>
        {layer.warnings.map((w) => (
          <p key={w} className="m-layer-warn">
            {w}
          </p>
        ))}
        <div className="m-layer-actions">
          <Button variant="quiet" disabled={isFirstOverall} onClick={() => edit({ op: "move", direction: "up" })} aria-label={`${upLabel}: ${layer.title}`}>
            {upLabel}
          </Button>
          <Button variant="quiet" disabled={isLastOverall} onClick={() => edit({ op: "move", direction: "down" })} aria-label={`${downLabel}: ${layer.title}`}>
            {downLabel}
          </Button>
          <Button variant="quiet" disabled={last} onClick={() => edit({ op: "merge" })} aria-label={`Merge ${layer.title} with the next layer`}>
            Merge with next
          </Button>
          <Button variant="quiet" disabled={layer.passages < 2} onClick={() => edit({ op: "split" })} aria-label={`Split ${layer.title} in two`}>
            Split in two
          </Button>
        </div>
      </div>
    </li>
  );
}

function PartBlock({ part, projectId, run }: { part: StructurePart; projectId: string; run: (f: () => Promise<string | null>) => void }) {
  const minutes = Math.max(1, Math.round(part.words / 230));
  const reading = minutes < 90 ? `about ${minutes} min` : `about ${Math.round(minutes / 6) / 10} hours`;
  return (
    <section className="m-part" aria-label={part.title}>
      <div className="m-gutter-row">
        <span className="m-margin-note" />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 className="m-part-key">{part.title}</h2>
            <p className="m-part-span">
              {part.span} · {part.layers.length} {part.layers.length === 1 ? "layer" : "layers"} · {reading} of reading
            </p>
            {part.warnings.map((w) => (
              <p key={w} className="m-layer-warn">
                {w}
              </p>
            ))}
          </div>
          {part.status === "approved" ? (
            <span className="m-approved">
              <Check /> Approved
            </span>
          ) : (
            <Button variant="accent" onClick={() => run(() => call(`/api/projects/${projectId}/structure/approve`, "POST", { part: part.key }))} aria-label={`Approve the layers of ${part.title}`}>
              Approve {part.title}
            </Button>
          )}
        </div>
      </div>
      <ol className="m-layers">
        {part.layers.map((l, i) => (
          <LayerRow key={`${l.id}:${l.title}:${l.bigQuestion}`} layer={l} index={i} part={part} projectId={projectId} run={run} />
        ))}
      </ol>
    </section>
  );
}

/** The plan for the course: Part A and Part B, each as a list of layers to rename, merge, split, move and approve. */
export function LayerPlan({ model }: { model: StructureModel }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [confirmingAgain, setConfirmingAgain] = useState(false);
  const { project, parts } = model;
  const approvedCount = parts.filter((p) => p.status === "approved").length;
  const allApproved = parts.length === 2 && approvedCount === 2;

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
    const err = await call(`/api/projects/${project.id}/structure/propose`, "POST");
    setProposing(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Plan the layers</h1>
          <p className="t-body mt-2 max-w-[62ch] text-panel-muted">
            {project.name}
            {project.courseCode ? `, ${project.courseCode}` : ""}.{" "}
            {parts.length
              ? "Margin split the course into two Parts and each Part into layers, one topic each. Rename them, merge or split them, move them, then approve each Part. Nothing is written until you do."
              : "Margin will read the course and suggest where to split it into Part A and Part B, and which topics each Part is made of. You approve the plan before anything is written."}
          </p>
        </div>
        {allApproved && (
          <Button variant="primary" size="lg" onClick={() => router.push(`/p/${project.id}`)}>
            Open the course
          </Button>
        )}
      </div>

      {error && (
        <p className="m-field-error mt-4 max-w-[62ch]" role="alert">
          {error}
        </p>
      )}

      {model.note && parts.length > 0 && (
        <p className="m-layer-warn mt-4 max-w-[62ch]" role="status" style={{ color: "var(--panel-ink)" }}>
          {model.note}
        </p>
      )}

      {proposing && (
        <p role="status" className="t-ui mt-6 text-panel-muted">
          Reading the course and proposing layers. This takes a minute or two.
        </p>
      )}

      {parts.length === 0 && !proposing && (
        <div className="mt-8">
          <Button variant="primary" size="lg" onClick={propose}>
            Suggest the layers
          </Button>
        </div>
      )}

      {parts.length > 0 && (
        <>
          <Surface kind="paper" raised className="mt-8 px-10 py-9">
            {parts.map((p) => (
              <PartBlock key={p.id} part={p} projectId={project.id} run={run} />
            ))}
          </Surface>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {allApproved ? (
              <Button variant="primary" size="lg" onClick={() => router.push(`/p/${project.id}`)}>
                Open the course
              </Button>
            ) : (
              <p className="t-ui text-panel-muted">{approvedCount} of 2 Parts approved.</p>
            )}
            {approvedCount === 0 &&
              (confirmingAgain ? (
                <>
                  <span className="t-ui">Replace this plan, including your edits?</span>
                  <Button onClick={propose} disabled={proposing}>
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
