"use client";

import Link from "next/link";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LayerList } from "@/components/layers/LayerList";
import { SourceViewer, type CiteTarget } from "@/components/layers/SourceViewer";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Segmented } from "@/components/ui/Segmented";
import { Workspace } from "@/components/workspace/Workspace";
import type { ExamListItem, ExamView } from "@/lib/exam/service";
import type { ExamSummary } from "@/lib/exam/types";
import type { StructureModel } from "@/lib/layers/types";
import { FeedbackView } from "./FeedbackView";
import { Room } from "./Room";
import { SummaryEditor } from "./SummaryEditor";
import { EmptyRoom } from "./EmptyRoom";
import { UpdateExamPanel } from "./UpdateExamPanel";

const LOST = "Margin lost the connection. Check that the app is still running, then try again.";
/** A request that returns the JSON, or says plainly what went wrong. */
async function call<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, init);
    const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    return r.ok ? { ok: true, data: data as T } : { ok: false, error: data?.error ?? "That didn't work. Try again." };
  } catch {
    return { ok: false, error: LOST };
  }
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * The exam room: a section beside the weeks. A sheet is read into a summary the student checks; then a start screen with one choice
 * (the real time limit or no timer); then the room; then feedback with Try again and New questions. Works best on a computer.
 */
export function ExamSection({ model, exams, view, isDemo, embedded = false }: { model: StructureModel; exams: ExamListItem[]; view: ExamView | null; isDemo: boolean; embedded?: boolean }) {
  const router = useRouter();
  const projectId = model.project.id;
  const sheetInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"reading" | "writing" | null>(null);
  const [timer, setTimer] = useState<"real" | "none">("real");
  const [again, setAgain] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [cited, setCited] = useState<CiteTarget | null>(null);
  const asked = useRef<Record<string, boolean>>({});
  const refresh = () => router.refresh();
  const cite = (page: number, file: string) => setCited({ file, page });

  const examId = view?.id;
  const run = useCallback(
    async (kind: "reading" | "writing", url: string) => {
      setStatus(kind);
      setError(null);
      const r = await call(url, { method: "POST" });
      setStatus(null);
      if (!r.ok) setError(r.error);
      else router.refresh();
    },
    [router],
  );

  // the sheet is read the first time the exam is opened, and the first practice set is written once the summary is confirmed
  useEffect(() => {
    if (!view) return;
    if (view.hasSheet && !view.summary && !isDemo && !asked.current[`r${view.id}`]) {
      asked.current[`r${view.id}`] = true;
      void run("reading", `/api/exams/${view.id}/read`);
    } else if (view.confirmed && !view.set && !asked.current[`w${view.id}`]) {
      asked.current[`w${view.id}`] = true;
      void run("writing", `/api/exams/${view.id}/sets`);
    }
  }, [view, isDemo, run]);

  const addSheet = async (file: File) => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const r = await call<{ id: string }>(`/api/projects/${projectId}/exams`, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/p/${projectId}/exam?e=${r.data.id}`);
    refresh();
  };
  const save = async (summary: ExamSummary, confirm: boolean) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/exams/${view.id}/summary`, { ...json({ summary, confirm }), method: "PUT" });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (confirm) setEditing(false);
    refresh();
  };
  const addMaterial = async (file: File) => {
    if (!view) return;
    const form = new FormData();
    form.append("file", file);
    const r = await call(`/api/exams/${view.id}/materials`, { method: "POST", body: form });
    if (!r.ok) setError(r.error);
    else refresh();
  };
  const removeMaterial = async (fileId: string) => {
    if (!view) return;
    const r = await call(`/api/exams/${view.id}/materials/${fileId}`, { method: "DELETE" });
    if (!r.ok) setError(r.error);
    else refresh();
  };
  const enter = async () => {
    if (!view?.set) return;
    setBusy(true);
    setError(null);
    const r = await call(`/api/exam-sets/${view.set.id}/attempts`, json({ timer }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setAgain(false);
    refresh();
  };
  const handIn = async (answers: Record<string, string>): Promise<string | null> => {
    if (!view?.attempt) return "There is no attempt to hand in.";
    const r = await call(`/api/exam-attempts/${view.attempt.id}/hand-in`, json({ answers }));
    if (!r.ok) return r.error;
    refresh();
    return null;
  };
  const newQuestions = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    setStatus("writing");
    const r = await call(`/api/exams/${view.id}/sets`, { method: "POST" });
    setStatus(null);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setAgain(false);
    refresh();
  };
  const del = async () => {
    if (!view) return;
    setBusy(true);
    const r = await call(`/api/exams/${view.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDeleting(false);
    router.push(`/p/${projectId}/exam`);
    refresh();
  };

  const minutes = view?.set?.minutes ?? view?.summary?.lengthMinutes ?? null;
  const inRoom = !!(view?.set && view.attempt && !view.attempt.handedInAt);
  const finished = !!(view?.set && view.attempt?.handedInAt && !again);
  const effectiveTimer = timer === "real" && view?.set?.minutes ? "real" : "none";

  return (
    <>
      <Workspace
        leftTitle="Layers"
        listName="layer list"
        topbar={
          // inside the course page (lock in) its own top bar and tabs are above, so this one is left out
          embedded ? undefined : (
          <>
            <BackToCourse projectId={projectId} course={model.project.name} own="exam" />
            <span className="t-label text-panel-muted" style={{ marginLeft: "auto" }}>
              Exam room
            </span>
          </>
        )
        }
        left={<LayerList model={model} activeId="exam" />}
        leftFooter={
          <>
            <Link href={`/p/${projectId}/notes`} className="m-left-link">
              <span>Note to Self</span>
            </Link>
            <Link href={`/p/${projectId}/talk`} className="m-left-link">
              <span>Let&rsquo;s talk!</span>
            </Link>
            <Link href={`/p/${projectId}/lecture-notes`} className="m-left-link">
              <span>Lecture notes</span>
            </Link>
            <Link href={`/p/${projectId}/exam`} className="m-left-link" aria-current="page">
              <span>Exam room</span>
            </Link>
          </>
        }
      >
        <section className="m-paper m-reading-pane m-tt ex" aria-label="Exam room">
          <div className="m-tt-head">
            <div>
              <p className="m-part-tag">Exam room</p>
              <h1 className="t-h1">{view?.title ?? "The exam room"}</h1>
            </div>
            <div className="ex-head-actions">
              {exams.length > 1 && (
                <Segmented label="Exams" idPrefix="exam-tab" panelId="exam-panel" value={view?.id ?? ""} onChange={(v) => router.push(`/p/${projectId}/exam?e=${v}`)} options={exams.map((e) => ({ value: e.id, label: e.title }))} />
              )}
              {!isDemo && (
                <>
                  <Button onClick={() => sheetInput.current?.click()} disabled={busy}>
                    Add exam sheet
                  </Button>
                  <input ref={sheetInput} type="file" hidden data-testid="exam-sheet-input" aria-label="Add exam sheet" accept=".pdf,.docx,.pptx,.txt,.md,.markdown" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addSheet(f); }} />
                </>
              )}
              {view?.confirmed && view.summary && (
                <Button onClick={() => setUpdating(true)} disabled={busy}>
                  Update exam details
                </Button>
              )}
              {view && !isDemo && (
                <Button variant="quiet" onClick={() => setDeleting(true)} aria-label={`Delete ${view.title}`}>
                  Delete
                </Button>
              )}
            </div>
          </div>

          <p className="ex-phone-note" role="note">
            The exam room works best on a computer. Open Margin on a laptop to practise; you can still read your exam sheets here.
          </p>

          <div className="m-scroll ex-body-wrap" id="exam-panel" role="tabpanel">
            <div className="ex-wrap ex-desktop">
              {error && (
                <p className="m-field-error" role="alert">
                  {error}
                </p>
              )}

              {!view && <EmptyRoom isDemo={isDemo} busy={busy} onFile={(f) => void addSheet(f)} onChoose={() => sheetInput.current?.click()} onError={setError} />}

              {view && !view.hasSheet && <p className="ex-lede">This exam has no sheet any more. Add an exam sheet, or delete this exam.</p>}

              {view && status === "reading" && (
                <p className="ex-lede" role="status">
                  Reading {view.sheetName}. It takes about a minute.
                </p>
              )}

              {view && view.hasSheet && !view.summary && status !== "reading" && !isDemo && (
                <div>
                  <p className="ex-lede">Margin hasn&rsquo;t read this sheet yet.</p>
                  <Button variant="accent" onClick={() => void run("reading", `/api/exams/${view.id}/read`)}>
                    Read the sheet
                  </Button>
                </div>
              )}

              {view?.summary && (!view.confirmed || editing) && (
                <SummaryEditor key={`${view.id}:${view.confirmed}:${editing}`} summary={view.summary} courseWeeks={view.courseWeeks} materials={view.materials} busy={busy} error={null} onSave={(s, c) => void save(s, c)} onAddMaterial={(f) => void addMaterial(f)} onRemoveMaterial={(id) => void removeMaterial(id)} onReread={() => void run("reading", `/api/exams/${view.id}/read`)} />
              )}

              {view?.confirmed && !editing && !finished && (
                <section className="ex-start" aria-label="Start">
                  <h2 className="t-h1">The exam room</h2>
                  <p className="ex-label">Practice in your exam&rsquo;s format, built from your course. These are not predicted questions.</p>
                  {status === "writing" || !view.set ? (
                    <p className="ex-lede" role="status">
                      Writing your practice exam from the sheet and your course. It takes about a minute.
                    </p>
                  ) : (
                    <>
                      <p className="ex-lede">
                        {view.set.questions.length} {view.set.questions.length === 1 ? "question" : "questions"} in {new Set(view.set.questions.map((q) => q.section)).size} {new Set(view.set.questions.map((q) => q.section)).size === 1 ? "section" : "sections"}, in the format of {view.title.toLowerCase()}.
                        {view.set.questions.length < view.set.planned ? ` The real exam has ${view.set.planned}; a practice set is shortened to ${view.set.questions.length}.` : ""}
                      </p>
                      <fieldset className="ex-choice">
                        <legend>Timer</legend>
                        <label className="ex-radio" data-disabled={minutes ? undefined : ""}>
                          <input type="radio" name="timer" checked={effectiveTimer === "real"} disabled={!view.set.minutes} onChange={() => setTimer("real")} />
                          <span>
                            Use the real time limit{view.set.minutes ? <small> {view.set.minutes} minutes{view.set.minutes !== view.summary?.lengthMinutes ? `, scaled to this shorter set (${view.summary?.lengthMinutes} on the sheet)` : ", from your sheet"}</small> : <small> your sheet gives none</small>}
                          </span>
                        </label>
                        <label className="ex-radio">
                          <input type="radio" name="timer" checked={effectiveTimer === "none"} onChange={() => setTimer("none")} />
                          <span>No timer</span>
                        </label>
                      </fieldset>
                      <div className="ex-actions">
                        <Button variant="accent" size="lg" onClick={() => void enter()} disabled={busy}>
                          {busy ? "Entering…" : "Enter the room"}
                        </Button>
                        <Button variant="quiet" onClick={() => setEditing(true)}>
                          Check the summary of the sheet
                        </Button>
                      </div>
                    </>
                  )}
                  <Attempts attempts={view.attempts} />
                </section>
              )}

              {view?.set && view.attempt?.handedInAt && finished && (
                <FeedbackView set={view.set} attempt={view.attempt} busy={busy || status === "writing"} onTryAgain={() => setAgain(true)} onNewQuestions={() => void newQuestions()} onCite={cite} />
              )}
            </div>
          </div>
        </section>
      </Workspace>
      {inRoom && view?.set && view.attempt && <Room key={view.attempt.id} title={view.title} set={view.set} attempt={view.attempt} onHandIn={handIn} onCite={cite} />}
      <SourceViewer projectId={projectId} target={cited} onClose={() => setCited(null)} />
      {updating && view?.summary && (
        <UpdateExamPanel
          open
          examId={view.id}
          summary={view.summary}
          courseWeeks={view.courseWeeks}
          onClose={() => setUpdating(false)}
          onSaved={() => {
            setUpdating(false);
            setAgain(false);
            asked.current[`w${view.id}`] = false; // the next practice set is written in the new format
            refresh();
          }}
        />
      )}
      <ConfirmDialog open={deleting} title={`Delete ${view?.title ?? "this exam"}?`} confirmLabel="Delete exam" busy={busy} onConfirm={() => void del()} onCancel={() => setDeleting(false)}>
        <p>This permanently deletes its sheet, the past exams you added, every practice set and your attempts with their feedback. It cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}

const dateOf = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Every attempt at this exam, newest first. One sat before the exam's details were updated says "old format". */
function Attempts({ attempts }: { attempts: ExamView["attempts"] }) {
  if (!attempts.length) return null;
  return (
    <section className="ex-attempts" aria-labelledby="ex-attempts-h">
      <h3 id="ex-attempts-h" className="t-h3">
        Your attempts
      </h3>
      <ol>
        {attempts.map((a) => (
          <li key={a.id} data-old-format={a.oldFormat ? "" : undefined}>
            <span>
              Practice set {a.setNumber}
              {a.earned !== null && a.total !== null ? `: ${a.earned} of ${a.total} marks` : a.handedInAt ? "" : ": not handed in"}
            </span>
            <span className="ex-attempt-when">{dateOf(a.handedInAt ?? a.startedAt)}</span>
            {a.oldFormat && <span className="ex-old">old format</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
