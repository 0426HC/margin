"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { summaryChanges } from "@/lib/exam/changes";
import type { ExamSummary } from "@/lib/exam/types";
import { SummaryFields } from "./SummaryEditor";

const noSubscribe = () => () => {};
const LOST = "Margin lost the connection. Check that the app is still running, then try again.";

/**
 * "Update exam details": a panel from the right with the exam's details already filled in. The student changes what is new, or adds an
 * updated sheet or a note of what they heard, which Margin reads and turns into proposed changes in the same fields. "What changes" lists
 * every difference before anything is saved; only Confirm changes saves them, as a new version of the exam. A native modal <dialog>.
 */
export function UpdateExamPanel({ open, examId, summary, courseWeeks, onClose, onSaved }: { open: boolean; examId: string; summary: ExamSummary; courseWeeks: number; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const host = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  const [draft, setDraft] = useState<ExamSummary>(summary);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const changes = useMemo(() => summaryChanges(summary, draft), [summary, draft]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("input, textarea, select")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, host]);

  const propose = async (sheet: File | null) => {
    setReading(true);
    setError(null);
    const form = new FormData();
    form.append("note", note);
    if (sheet) form.append("file", sheet);
    try {
      const r = await fetch(`/api/exams/${examId}/update/propose`, { method: "POST", body: form });
      const data = (await r.json().catch(() => null)) as { summary?: ExamSummary; error?: string } | null;
      if (!r.ok || !data?.summary) throw new Error(data?.error ?? "Margin couldn't read that. Try again.");
      setDraft(data.summary);
      const n = summaryChanges(summary, data.summary).length;
      setRead(n ? `Margin read ${sheet && note.trim() ? "the sheet and your note" : sheet ? "the sheet" : "your note"} and filled in ${n === 1 ? "one change. Check it below." : `${n} changes. Check them below.`}` : `Margin read ${sheet ? "the sheet" : "your note"} and found nothing different from your current details.`);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
    } finally {
      setReading(false);
    }
  };

  const saveChanges = async () => {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.append("summary", JSON.stringify(draft));
    form.append("note", note);
    if (file) form.append("file", file);
    try {
      const r = await fetch(`/api/exams/${examId}/update`, { method: "POST", body: form });
      const data = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(data?.error ?? "Margin couldn't save the changes. Try again.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
      setSaving(false);
    }
  };

  const busy = reading || saving;
  if (!host) return null;
  return createPortal(
    <dialog
      ref={ref}
      className="m-paper ex-panel"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-line`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      {open && (
        <form
          className="ex-panel-in"
          onSubmit={(e) => {
            e.preventDefault();
            if (changes.length && !busy) void saveChanges();
          }}
        >
          <header className="ex-panel-head">
            <h2 id={`${id}-title`} className="t-h2">
              Update exam details
            </h2>
            <p id={`${id}-line`} className="ex-panel-line">
              Already filled in with your current exam. Change anything that&rsquo;s new.
            </p>
          </header>

          <div className="ex-panel-body">
            <div className="ex-form ex-panel-form">
              <SummaryFields value={draft} onChange={setDraft} courseWeeks={courseWeeks} />
            </div>

            <fieldset className="ex-fieldset ex-panel-news">
              <legend>Something new from your professor?</legend>
              <div className="ex-panel-sheet">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".pdf,.docx"
                  data-testid="exam-update-sheet"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (!f) return;
                    setFile(f);
                    void propose(f);
                  }}
                />
                <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                  Add an updated sheet
                </Button>
                <span className="ex-hint">{file ? file.name : "PDF or Word"}</span>
              </div>
              <label className="ex-field">
                <span>A note of what you heard</span>
                <textarea className="ex-input ex-area" rows={3} value={note} maxLength={2000} placeholder="Prof said Part II will have three essay choices" onChange={(e) => setNote(e.target.value)} />
              </label>
              {(note.trim() || file) && (
                <div>
                  <Button variant="accent" onClick={() => void propose(file)} disabled={busy}>
                    {reading ? "Reading…" : file && note.trim() ? "Read the sheet and note" : file ? "Read the sheet again" : "Read my note"}
                  </Button>
                </div>
              )}
              {read && !reading && (
                <p className="ex-hint" role="status">
                  {read}
                </p>
              )}
            </fieldset>

            <section className="ex-changes" aria-labelledby={`${id}-changes`}>
              <h3 id={`${id}-changes`} className="t-h3">
                What changes
              </h3>
              {changes.length ? (
                <ul>
                  {changes.map((c, i) => (
                    <li key={i}>
                      <span className="ex-change-label">{c.label}:</span>{" "}
                      {c.from !== null && <del>{c.from}</del>}
                      {c.from !== null && c.to !== null && <span aria-hidden="true"> → </span>}
                      {c.to !== null ? <ins>{c.to}</ins> : <span className="ex-change-gone"> (removed)</span>}
                      {c.from === null && <span className="ex-change-gone"> (added)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ex-hint">Nothing yet. Change a field, or add an updated sheet or a note.</p>
              )}
              <p className="ex-changes-keep">Your past attempts stay, labelled &ldquo;old format&rdquo;. New practice exams use the new format.</p>
            </section>
          </div>

          <footer className="ex-panel-foot">
            {error && (
              <p className="m-field-error" role="alert">
                {error}
              </p>
            )}
            <div className="ex-panel-actions">
              <Button onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button variant="accent" type="submit" disabled={busy || !changes.length}>
                {saving ? "Saving…" : "Confirm changes"}
              </Button>
            </div>
          </footer>
        </form>
      )}
    </dialog>,
    host,
  );
}
