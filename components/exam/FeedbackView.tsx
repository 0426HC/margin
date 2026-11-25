"use client";

import { CitedText, type CiteHandler } from "@/components/ui/Citation";
import { Button } from "@/components/ui/Button";
import type { AttemptView, ExamSetView } from "@/lib/exam/service";
import { FORMAT_LABEL } from "@/lib/exam/types";
import { Origins } from "./Origins";

/** Feedback after handing in: the tally, then each question with the student's answer, how it was marked (by code or by the Examiner) and what to fix. */
export function FeedbackView({ set, attempt, busy, onTryAgain, onNewQuestions, onCite }: { set: ExamSetView; attempt: AttemptView; busy: boolean; onTryAgain: () => void; onNewQuestions: () => void; onCite: CiteHandler }) {
  const f = attempt.feedback!;
  const by = new Map(f.results.map((r) => [r.id, r]));
  return (
    <section className="ex-feedback" aria-label="Feedback">
      <h2 className="t-h2">
        {f.earned} of {f.total} marks
      </h2>
      <p className="ex-lede" role="status">
        {f.answered} answered{f.skipped ? `, ${f.skipped} skipped` : ""}. Practice set {set.number}. These questions are practice in your exam&rsquo;s format; they are not predictions.
      </p>
      <div className="ex-actions">
        <Button variant="accent" onClick={onTryAgain} disabled={busy}>
          Try again
        </Button>
        <Button onClick={onNewQuestions} disabled={busy}>
          {busy ? "Writing new questions…" : "New questions"}
        </Button>
      </div>
      <p className="ex-hint">Try again uses the same questions. New questions writes a fresh set in the same format, on different ground, leaning toward the layers you are weaker on.</p>
      <ol className="ex-results">
        {set.questions.map((q, i) => {
          const r = by.get(q.id)!;
          const mine = (attempt.answers[q.id] ?? "").trim();
          return (
            <li key={q.id} className="ex-result" data-status={r.status}>
              <p className="ex-meta">
                Question {i + 1} · {FORMAT_LABEL[q.format]} · {r.status === "skipped" ? `skipped, ${q.marks} ${q.marks === 1 ? "mark" : "marks"}` : `${r.marksAwarded} of ${q.marks} ${q.marks === 1 ? "mark" : "marks"}`}
                {r.status === "marked" && ` · marked by ${r.by === "code" ? "code" : "the Examiner"}`}
              </p>
              <p className="ex-prompt">{q.prompt}</p>
              <Origins origins={q.builtFrom} onCite={onCite} />
              {r.status === "skipped" ? (
                <p className="ex-skipped">You skipped this one. It was not marked down.</p>
              ) : (
                <>
                  <p className="ex-yours">
                    <b>Your answer:</b> {q.format === "multiple_choice" ? (q.options?.[Number(mine)] ?? mine) : mine}
                  </p>
                  {r.strengths && <p className="ex-strengths">{r.strengths}</p>}
                  {r.fixes.length > 0 && (
                    <ul className="ex-fixes" aria-label="What to fix">
                      {r.fixes.map((x, k) => (
                        <li key={k}>
                          <CitedText text={x} onCite={onCite} />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
