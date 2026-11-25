"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { AttemptView, ExamSetView } from "@/lib/exam/service";
import { FORMAT_LABEL } from "@/lib/exam/types";
import { Origins } from "./Origins";

const noSubscribe = () => () => {};
const clock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};

/**
 * The room: the page dims and the question paper slides up. One question at a time, a list of the questions at the side, the timer at the
 * top if one was chosen, and "Hand it in" at any moment. Answers autosave. Nothing here animates on a keyboard action.
 */
export function Room({ title, set, attempt, onHandIn, onCite }: { title: string; set: ExamSetView; attempt: AttemptView; onHandIn: (answers: Record<string, string>) => Promise<string | null>; onCite: (page: number, file: string) => void }) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(attempt.answers);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const answersRef = useRef(answers);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handed = useRef(false);
  const host = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  const q = set.questions[at];
  const answered = (id: string) => (answers[id] ?? "").trim() !== "";
  const count = set.questions.filter((x) => answered(x.id)).length;
  const left = attempt.deadline ? attempt.deadline - now : null;

  const save = useCallback(
    (a: Record<string, string>) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void fetch(`/api/exam-attempts/${attempt.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: a }) }).catch(() => undefined), 600);
    },
    [attempt.id],
  );
  const change = (id: string, v: string) => {
    const next = { ...answersRef.current, [id]: v };
    answersRef.current = next;
    setAnswers(next);
    save(next);
  };

  const handIn = useCallback(async () => {
    if (handed.current) return;
    handed.current = true;
    setBusy(true);
    setError(null);
    clearTimeout(saveTimer.current);
    const failed = await onHandIn(answersRef.current);
    if (failed) {
      handed.current = false;
      setBusy(false);
      setError(failed);
    }
  }, [onHandIn]);

  // the timer: once a second, and the paper is handed in when it runs out
  useEffect(() => {
    if (!attempt.deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [attempt.deadline]);
  useEffect(() => {
    if (left !== null && left <= 0) void handIn();
  }, [left, handIn]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (!host) return null;
  return createPortal(
    <div className="ex-room" role="dialog" aria-modal="true" aria-label={`${title}, practice exam`}>
      <div className="ex-scrim" />
      <div className="ex-paper m-paper">
        <header className="ex-bar">
          <h2 className="t-h3">{title}</h2>
          <span className="ex-set">Practice set {set.number}</span>
          {left !== null && (
            <span className="ex-timer" role="timer" aria-label="Time left" data-low={left < 5 * 60_000 ? "" : undefined}>
              {clock(left)} left
            </span>
          )}
          <Button variant="accent" onClick={() => setConfirm(true)} disabled={busy}>
            Hand it in
          </Button>
        </header>
        <div className="ex-body">
          <nav className="ex-progress" aria-label="Questions">
            <ol>
              {set.questions.map((x, i) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setAt(i)} aria-current={i === at ? "step" : undefined} aria-label={`Question ${i + 1}, ${answered(x.id) ? "answered" : "not answered"}`}>
                    <span className="ex-mark" data-done={answered(x.id) ? "" : undefined} aria-hidden="true" />
                    <span>{i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="ex-count">
              {count} of {set.questions.length} answered
            </p>
          </nav>
          <main className="ex-question" key={q.id}>
            <p className="ex-meta">
              Question {at + 1} of {set.questions.length} · {FORMAT_LABEL[q.format]} · {q.marks} {q.marks === 1 ? "mark" : "marks"}
            </p>
            <p className="ex-prompt">{q.prompt}</p>
            <Origins origins={q.builtFrom} onCite={onCite} />
            {q.format === "multiple_choice" ? (
              <div role="radiogroup" aria-label="Choose one answer" className="ex-options">
                {q.options!.map((o, i) => (
                  <label key={i} className="ex-option" data-picked={answers[q.id] === String(i) ? "" : undefined}>
                    <input type="radio" name={q.id} checked={answers[q.id] === String(i)} onChange={() => change(q.id, String(i))} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            ) : (
              <textarea className="ex-answer" aria-label="Your answer" rows={q.format === "essay" ? 16 : q.format === "problem" ? 12 : 7} value={answers[q.id] ?? ""} onChange={(e) => change(q.id, e.target.value)} placeholder="Write your answer here." />
            )}
            <div className="ex-nav">
              <Button onClick={() => setAt(at - 1)} disabled={at === 0}>
                Previous
              </Button>
              <Button onClick={() => setAt(at + 1)} disabled={at === set.questions.length - 1}>
                Next
              </Button>
            </div>
          </main>
        </div>
        {error && (
          <p className="m-field-error ex-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="ex-busy" role="status">
            Handing in. The Examiner is reading your answers…
          </p>
        )}
      </div>
      <ConfirmDialog open={confirm} title="Hand it in?" confirmLabel="Hand it in" busy={busy} busyLabel="Handing in…" onConfirm={() => void handIn().then(() => setConfirm(false))} onCancel={() => setConfirm(false)}>
        <p>
          You have answered {count} of {set.questions.length} questions. {count < set.questions.length ? "The rest are skipped, not marked down." : ""} You can try again with the same questions afterwards.
        </p>
      </ConfirmDialog>
    </div>,
    host,
  );
}
