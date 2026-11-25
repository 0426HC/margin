"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarginRow } from "@/components/workspace/MarginGutter";
import type { FullReading, ReadingFile } from "@/lib/layers/full-reading";

/** The switch above Source: off shows this layer's passages, on shows a whole reading of the week. */
export function FullReadingSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="m-fr-switch" onClick={() => onChange(!on)}>
      <span className="m-fr-track" aria-hidden="true">
        <span className="m-fr-knob" />
      </span>
      <span>Show full reading</span>
    </button>
  );
}

const stem = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "");

/**
 * A whole reading or lecture file of the layer's week, exactly as stored, with the passages this layer is built from marked. A small
 * picker lists the week's files (tabs for a few, a menu for many); the first file this layer draws on opens first, at its first mark.
 */
export function FullReadingView({ layerId, onMounted }: { layerId: string; onMounted: () => void }) {
  const [files, setFiles] = useState<ReadingFile[] | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [view, setView] = useState<FullReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(onMounted, [onMounted]);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/layers/${layerId}/reading`, { signal: ctl.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { files: ReadingFile[] }) : Promise.reject(((await r.json().catch(() => null)) as { error?: string } | null)?.error)))
      .then(({ files }) => {
        setFiles(files);
        setFileId((files.find((f) => f.inLayer > 0) ?? files[0])?.id ?? null);
      })
      .catch((e: unknown) => !ctl.signal.aborted && setError(typeof e === "string" ? e : "Margin couldn't list this week's readings. Check that the app is still running."));
    return () => ctl.abort();
  }, [layerId]);

  useEffect(() => {
    if (!fileId) return;
    const ctl = new AbortController();
    fetch(`/api/layers/${layerId}/reading?file=${encodeURIComponent(fileId)}`, { signal: ctl.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as FullReading) : Promise.reject(((await r.json().catch(() => null)) as { error?: string } | null)?.error)))
      .then((v) => {
        setError(null);
        setView(v);
      })
      .catch((e: unknown) => !ctl.signal.aborted && setError(typeof e === "string" ? e : "Margin couldn't open that reading. Check that the app is still running."));
    return () => ctl.abort();
  }, [layerId, fileId]);

  // open at the first passage this layer is built from, so the reader lands where the layer is
  useEffect(() => {
    if (!view || view.fileId !== fileId) return;
    root.current?.querySelector("mark")?.scrollIntoView({ block: "center" });
  }, [view, fileId]);

  if (error)
    return (
      <p className="m-note" role="alert">
        {error}
      </p>
    );
  if (!files) return <p className="m-note" role="status">Opening this week&rsquo;s readings…</p>;
  if (!files.length) return <p className="m-note">This week has no readings or lecture files with text in Margin.</p>;

  const label = (f: ReadingFile) => `${stem(f.name)}${f.role === "Lecture" ? " (lecture)" : ""}`;
  const shown = view && view.fileId === fileId ? view : null;
  return (
    <div ref={root} className="m-fr">
      {files.length <= 4 ? (
        <div className="m-fr-picker" role="group" aria-label="This week's readings">
          {files.map((f) => (
            <button key={f.id} type="button" aria-pressed={f.id === fileId} onClick={() => setFileId(f.id)}>
              {label(f)}
            </button>
          ))}
        </div>
      ) : (
        <label className="m-fr-menu">
          <span className="sr-only">Which of this week&rsquo;s readings to show</span>
          <select className="m-select" value={fileId ?? ""} onChange={(e) => setFileId(e.target.value)}>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {label(f)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="m-fr-note">
        {shown
          ? shown.marked
            ? "The whole text, exactly as in your file. The passages this layer is built from are marked."
            : "The whole text, exactly as in your file. This layer doesn't draw on it."
          : "Opening the reading…"}
      </p>
      {shown && (
        <div className="m-fr-text m-sv-text" aria-label={`${shown.file}, full text`}>
          {shown.blocks.map((b, i) => {
            const first = i === 0 || shown.blocks[i - 1].page !== b.page;
            const inner = b.parts.map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : p.text));
            return (
              <MarginRow key={i} marks={first ? [{ kind: "page", page: b.page, file: shown.file }] : []}>
                {b.kind === "heading" ? <h3 className="m-q-head">{inner}</h3> : <p className={b.kind === "list" ? "m-q-list" : undefined}>{inner}</p>}
              </MarginRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
