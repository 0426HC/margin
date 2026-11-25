"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TYPE_CHOICES, type CourseFileRow, type FileType } from "@/lib/projects/file-kinds";
import { call } from "./api";

/** "Check this": Claude wasn't sure of this file's week or type. It goes once the student sets either. */
function CheckThis() {
  return (
    <span className="m-check" title="Claude wasn't sure about this file. Change its week or type if they're wrong.">
      check this
    </span>
  );
}

/**
 * The files of a course with their week and type, each changeable. A change applies at once: layer week labels, the Lecture tab and the
 * Weeks view follow it. Used on the review screen and on the course's own files page.
 */
export function FilesPanel({ projectId, files, weekCount }: { projectId: string; files: CourseFileRow[]; weekCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const top = Math.max(weekCount, ...files.map((f) => f.week ?? 0), 1);

  async function change(f: CourseFileRow, patch: { week?: number | null; type?: FileType }) {
    setBusy(f.id);
    setError(null);
    const err = await call(`/api/projects/${projectId}/files/${f.id}`, "PATCH", patch);
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div className="m-files">
      {error && (
        <p className="m-field-error" role="alert">
          {error}
        </p>
      )}
      <ul className="m-files-list">
        {files.map((f) => (
          <li key={`${f.id}:${f.week}:${f.type}`} className="m-files-row" data-busy={busy === f.id || undefined} data-unlabelled={f.type ? undefined : true}>
            <div className="min-w-0">
              <div className="m-file-name">{f.name}</div>
              {f.folder && <div className="m-file-path">{f.folder}</div>}
              {(f.reason || f.check || !f.type) && (
                <p className="m-file-reason">
                  {f.check && <CheckThis />}
                  {f.type ? f.reason : "Not labelled yet. Choose its week and type."}
                </p>
              )}
            </div>
            <label className="m-files-field">
              <span className="sr-only">Week of {f.name}</span>
              <select className="m-select" value={f.week ?? ""} disabled={busy === f.id} onChange={(e) => void change(f, { week: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No week</option>
                {Array.from({ length: top }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Week {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="m-files-field">
              <span className="sr-only">Type of {f.name}</span>
              <select className="m-select" value={f.type ?? ""} disabled={busy === f.id} onChange={(e) => e.target.value && void change(f, { type: e.target.value as FileType })}>
                {!f.type && <option value="">Choose a type</option>}
                {TYPE_CHOICES.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
