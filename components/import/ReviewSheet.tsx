"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { KIND_LABEL } from "@/lib/import/kinds";
import { folderOf, stripCommonRoot } from "@/lib/import/paths";
import type { FileKind } from "@/lib/import/types";
import type { ReviewFile, ReviewModel, ReviewSection, ReviewUnit } from "@/lib/projects/types";

const WORDS_PER_MINUTE = 230;
const minutes = (words: number) => Math.max(1, Math.round(words / WORDS_PER_MINUTE));
const fmt = (n: number) => n.toLocaleString("en-US");

function pageLabel(kind: ReviewFile["pageKind"], a: number, b: number) {
  const word = kind === "slide" ? "slide" : "p";
  if (kind === "slide") return a === b ? `slide ${a}` : `slides ${a}–${b}`;
  return a === b ? `${word}. ${a}` : `pp. ${a}–${b}`;
}

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!r) return "Margin lost the connection. Check that the app is still running, then try again.";
  if (r.ok) return null;
  return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";
}

function UnitTitle({ unit, onRename }: { unit: ReviewUnit; onRename: (title: string) => void }) {
  const [value, setValue] = useState(unit.title);
  return (
    <input
      className="m-unit-title"
      aria-label={`Name of ${unit.title}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const t = value.trim();
        if (!t) setValue(unit.title);
        else if (t !== unit.title) onRename(t);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function SectionRow({ section, kind }: { section: ReviewSection; kind: ReviewFile["pageKind"] }) {
  return (
    <li className="m-sheet-section m-gutter-row">
      <span className="m-margin-note">{pageLabel(kind, section.pageStart, section.pageEnd)}</span>
      <div className="m-sheet-section-body">
        <span className="m-sheet-section-title">{section.title}</span>
        <span className="m-sheet-meta">
          {fmt(section.wordCount)} words · {minutes(section.wordCount)} min
        </span>
      </div>
    </li>
  );
}

function FileBlock({ file, folder, others, readOnly, onMove, onRemove }: { file: ReviewFile; folder: string; others: ReviewUnit[]; readOnly: boolean; onMove: (unitId: string) => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const kind = file.kind ? KIND_LABEL[file.kind as FileKind] : "";
  return (
    <div className="m-sheet-file">
      <div className="m-gutter-row">
        <span className="m-margin-note">{kind}</span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="m-file-name">{file.name}</div>
            {folder && <div className="m-file-path">{folder}</div>}
            {file.lowQuality && (
              <p className="m-file-note" style={{ marginTop: 4 }}>
                Text quality: low, may be a scan. The page numbers are right, but some words may be misread.
              </p>
            )}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              {others.length > 0 && (
                <select
                  className="m-select"
                  aria-label={`Move ${file.name} to another unit`}
                  value=""
                  onChange={(e) => e.target.value && onMove(e.target.value)}
                >
                  <option value="" disabled hidden>
                    Move to…
                  </option>
                  {others.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.title}
                    </option>
                  ))}
                </select>
              )}
              {confirming ? (
                <>
                  <span className="t-ui">Remove it from the project?</span>
                  <Button onClick={onRemove}>Yes, remove {file.name}</Button>
                  <Button variant="quiet" onClick={() => setConfirming(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button variant="quiet" onClick={() => setConfirming(true)} aria-label={`Remove ${file.name}`}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <ul className="m-sheet-sections">
        {file.sections.map((s) => (
          <SectionRow key={s.id} section={s} kind={file.pageKind} />
        ))}
      </ul>
    </div>
  );
}

function UnitBlock({ unit, units, folders, readOnly, projectId, run }: { unit: ReviewUnit; units: ReviewUnit[]; folders: Map<string, string>; readOnly: boolean; projectId: string; run: (f: () => Promise<string | null>) => void }) {
  const [merging, setMerging] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const others = units.filter((u) => u.id !== unit.id);
  const sections = unit.files.reduce((n, f) => n + f.sections.length, 0);
  const words = unit.files.reduce((n, f) => n + f.sections.reduce((m, s) => m + s.wordCount, 0), 0);
  return (
    <section className="m-sheet-unit" aria-label={unit.title}>
      <div className="m-gutter-row">
        <span className="m-margin-note" />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1" style={{ minWidth: "14rem" }}>
            {readOnly ? <h2 className="t-h3">{unit.title}</h2> : <UnitTitle key={unit.title} unit={unit} onRename={(title) => run(() => call(`/api/projects/${projectId}/units/${unit.id}`, "PATCH", { title }))} />}
            <p className="m-sheet-meta" style={{ marginTop: 4 }}>
              {unit.files.length} {unit.files.length === 1 ? "file" : "files"} · {sections} {sections === 1 ? "section" : "sections"} · about {minutes(words)} min of reading
            </p>
          </div>
          {!readOnly && others.length > 0 && !merging && (
            <Button variant="quiet" onClick={() => setMerging(true)} aria-label={`Merge ${unit.title} into another unit`}>
              Merge into another unit
            </Button>
          )}
          {!readOnly && others.length > 0 && merging && (
            <div className="flex items-center gap-2">
              <select className="m-select" aria-label={`Merge ${unit.title} into`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">Merge into…</option>
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.title}
                  </option>
                ))}
              </select>
              <Button disabled={!mergeInto} onClick={() => run(() => call(`/api/projects/${projectId}/units/merge`, "POST", { fromId: unit.id, intoId: mergeInto }))} aria-label={`Merge ${unit.title}`}>
                Merge
              </Button>
              <Button variant="quiet" onClick={() => { setMerging(false); setMergeInto(""); }}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
      {unit.files.map((f) => (
        <FileBlock
          key={f.id}
          file={f}
          folder={folders.get(f.id) ?? ""}
          others={others}
          readOnly={readOnly}
          onMove={(unitId) => run(() => call(`/api/files/${f.id}`, "PATCH", { unitId }))}
          onRemove={() => run(() => call(`/api/files/${f.id}`, "DELETE"))}
        />
      ))}
    </section>
  );
}

/** The course as one long sheet: units as headed parts, files under them, sections under the files, page ranges in the margin. */
export function ReviewSheet({ review, readOnly = false }: { review: ReviewModel; readOnly?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const { project, units, failed } = review;
  const sections = units.reduce((n, u) => n + u.files.reduce((m, f) => m + f.sections.length, 0), 0);
  const allFiles = units.flatMap((u) => u.files);
  const files = allFiles.length;
  const stripped = stripCommonRoot(allFiles.map((f) => f.relPath));
  const folders = new Map(allFiles.map((f, i) => [f.id, folderOf(stripped[i])]));
  const hasVirtual = allFiles.some((f) => f.pageKind === "virtual");

  function run(f: () => Promise<string | null>) {
    void f().then((err) => {
      setError(err);
      if (!err) router.refresh();
    });
  }

  async function open() {
    setOpening(true);
    const err = await call(`/api/projects/${project.id}/finish`, "POST");
    if (err) {
      setError(err);
      setOpening(false);
    } else router.push(`/p/${project.id}/setup`);
  }

  const openButton = (
    <Button variant="primary" size="lg" onClick={open} disabled={opening || sections === 0}>
      {opening ? "One moment" : "Plan the layers"}
    </Button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">{readOnly ? project.name : "Check the units"}</h1>
          <p className="t-body mt-2 max-w-[60ch] text-panel-muted">
            {readOnly ? "" : `${project.name}${project.courseCode ? `, ${project.courseCode}` : ""}. `}
            {files} {files === 1 ? "file" : "files"} became {sections} {sections === 1 ? "section" : "sections"} in {units.length} {units.length === 1 ? "unit" : "units"}.
            {!readOnly && " Rename a unit, move a file, merge two units or remove a file. The text itself is never changed."}
          </p>
        </div>
        {!readOnly && openButton}
      </div>

      {hasVirtual && (
        <p className="t-ui mt-3 max-w-[60ch] text-panel-muted">Word, text and Markdown files have no fixed pages, so Margin numbers their pages by about 400 words. Citations use those numbers.</p>
      )}

      {error && (
        <p className="m-field-error mt-4" role="alert">
          {error}
        </p>
      )}

      {failed.length > 0 && !readOnly && (
        <Surface kind="slip" className="mt-6 max-w-[720px] px-5 py-4">
          <h2 className="t-heading-s">
            {failed.length} {failed.length === 1 ? "file was" : "files were"} left out
          </h2>
          <ul className="m-0 mt-2 list-none p-0">
            {failed.map((f) => (
              <li key={f.id} className="t-ui" style={{ marginTop: 6 }}>
                <span className="m-file-name">{f.name}</span>
                <span className="block text-ink-muted">{f.error}</span>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      <Surface kind="paper" raised className="mt-8 px-10 py-9">
        {units.length === 0 ? (
          <p className="t-body">There is nothing to read here yet. Start a new project and choose a folder with readable files.</p>
        ) : (
          units.map((u) => <UnitBlock key={u.id} unit={u} units={units} folders={folders} readOnly={readOnly} projectId={project.id} run={run} />)
        )}
      </Surface>

      {!readOnly && units.length > 0 && <div className="mt-6">{openButton}</div>}
    </div>
  );
}
