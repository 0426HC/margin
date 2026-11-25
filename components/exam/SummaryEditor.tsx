"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FORMATS, FORMAT_LABEL, type ExamSummary } from "@/lib/exam/types";

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const num = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * What Margin read from the exam sheet, as a form. The student checks every part and edits what is wrong; only when they say it looks right
 * is anything generated. Nothing here is a guess dressed up as a fact: what the sheet didn't say is empty.
 */
export function SummaryEditor({ summary, courseWeeks, materials, busy, error, onSave, onAddMaterial, onRemoveMaterial, onReread }: {
  summary: ExamSummary;
  courseWeeks: number;
  materials: { fileId: string; name: string }[];
  busy: boolean;
  error: string | null;
  onSave: (s: ExamSummary, confirm: boolean) => void;
  onAddMaterial: (file: File) => void;
  onRemoveMaterial: (fileId: string) => void;
  onReread: () => void;
}) {
  const [d, setD] = useState<ExamSummary>(summary);
  return (
    <form className="ex-form" onSubmit={(e) => {
        e.preventDefault();
        onSave(d, true);
      }} aria-label="Summary of the exam sheet">
      <p className="ex-lede">Margin read your sheet. Check each part against it and fix anything that is wrong. Nothing is written until you say it looks right.</p>

      <SummaryFields value={d} onChange={setD} courseWeeks={courseWeeks} />

      <fieldset className="ex-fieldset">
        <legend>Past or practice exams</legend>
        <p className="ex-hint">Add earlier exams of this course, if you have them. Questions can follow their style.</p>
        <ul className="ex-plain">
          {materials.map((m) => (
            <li key={m.fileId}>
              {m.name}{" "}
              <Button variant="quiet" onClick={() => onRemoveMaterial(m.fileId)} aria-label={`Remove ${m.name}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <label className="ex-upload">
          <input type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md,.markdown" data-testid="exam-material-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAddMaterial(f); }} />
          <span className="m-btn" data-variant="secondary" tabIndex={0} role="button" onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") (e.currentTarget.previousElementSibling as HTMLInputElement).click();
            }} onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement).click()}>
            Add a past exam
          </span>
        </label>
      </fieldset>

      {error && (
        <p className="m-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="ex-actions">
        <Button variant="accent" type="submit" disabled={busy}>
          {busy ? "Saving…" : "This looks right"}
        </Button>
        <Button onClick={() => onSave(d, false)} disabled={busy}>
          Save for later
        </Button>
        <Button variant="quiet" onClick={onReread} disabled={busy}>
          Read the sheet again
        </Button>
      </div>
    </form>
  );
}

/**
 * The fields of an exam's details: title, date, length, marks, the sections, the weeks, topics, marking guide, terms and sample questions.
 * The setup form and "Update exam details" use the same ones.
 */
export function SummaryFields({ value: d, onChange, courseWeeks }: { value: ExamSummary; onChange: (s: ExamSummary) => void; courseWeeks: number }) {
  const set = (p: Partial<ExamSummary>) => onChange({ ...d, ...p });
  const section = (i: number, p: Partial<ExamSummary["sections"][number]>) => set({ sections: d.sections.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const total = d.sections.reduce((n, s) => n + s.count, 0);
  return (
    <>
        <div className="ex-grid">
          <label className="ex-field">
            <span>Title</span>
            <input className="ex-input" value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="ex-field">
            <span>Date</span>
            <input className="ex-input" value={d.date ?? ""} maxLength={60} placeholder="Not on the sheet" onChange={(e) => set({ date: e.target.value.trim() ? e.target.value : null })} />
          </label>
          <label className="ex-field">
            <span>Length, in minutes</span>
            <input className="ex-input" inputMode="numeric" value={d.lengthMinutes ?? ""} placeholder="Not on the sheet" onChange={(e) => set({ lengthMinutes: num(e.target.value) })} />
          </label>
          <label className="ex-field">
            <span>Total marks</span>
            <input className="ex-input" inputMode="numeric" value={d.totalMarks ?? ""} placeholder="Not on the sheet" onChange={(e) => set({ totalMarks: num(e.target.value) })} />
          </label>
        </div>

        <fieldset className="ex-fieldset">
          <legend>Sections and question types ({total} {total === 1 ? "question" : "questions"})</legend>
          {d.sections.map((s, i) => (
            <div className="ex-section" key={i}>
              <input className="ex-input" aria-label={`Name of section ${i + 1}`} value={s.name} maxLength={80} onChange={(e) => section(i, { name: e.target.value })} />
              <select className="ex-input" aria-label={`Question type of ${s.name}`} value={s.format} onChange={(e) => section(i, { format: e.target.value as typeof s.format })}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
              <label className="ex-mini">
                <span>How many</span>
                <input className="ex-input" inputMode="numeric" aria-label={`How many questions in ${s.name}`} value={s.count} onChange={(e) => section(i, { count: Math.max(1, Math.min(100, num(e.target.value) ?? 1)) })} />
              </label>
              <label className="ex-mini">
                <span>Marks each</span>
                <input className="ex-input" inputMode="decimal" aria-label={`Marks for each question in ${s.name}`} value={s.marksEach ?? ""} placeholder="?" onChange={(e) => section(i, { marksEach: num(e.target.value) })} />
              </label>
              <Button variant="quiet" onClick={() => set({ sections: d.sections.filter((_, k) => k !== i) })} disabled={d.sections.length < 2} aria-label={`Remove ${s.name}`}>
                Remove
              </Button>
              <input className="ex-input ex-section-instr" aria-label={`Instructions for ${s.name}`} value={s.instructions} maxLength={600} placeholder="Instructions for this part (for example, answer 5 of 8)" onChange={(e) => section(i, { instructions: e.target.value })} />
            </div>
          ))}
          <Button onClick={() => set({ sections: [...d.sections, { name: `Section ${String.fromCharCode(65 + d.sections.length)}`, format: "short_answer", count: 2, marksEach: null, instructions: "" }] })}>Add a section</Button>
        </fieldset>

        <fieldset className="ex-fieldset">
          <legend>Weeks it covers</legend>
          <div className="ex-weeks">
            {Array.from({ length: courseWeeks }, (_, i) => i + 1).map((w) => (
              <label key={w} className="ex-chip">
                <input type="checkbox" checked={d.weeks.includes(w)} onChange={(e) => set({ weeks: e.target.checked ? [...d.weeks, w].sort((a, b) => a - b) : d.weeks.filter((x) => x !== w) })} />
                <span>Week {w}</span>
              </label>
            ))}
          </div>
          <p className="ex-hint">{d.weeks.length ? "Questions come from these weeks." : "None chosen: questions can come from the whole course."}</p>
        </fieldset>

        <label className="ex-field">
          <span>Topics, one per line</span>
          <textarea className="ex-input ex-area" rows={3} value={d.topics.join("\n")} onChange={(e) => set({ topics: lines(e.target.value) })} />
        </label>
        <label className="ex-field">
          <span>Marking guide</span>
          <textarea className="ex-input ex-area" rows={4} value={d.markingGuide} onChange={(e) => set({ markingGuide: e.target.value })} placeholder="The sheet gives no marking guide. Answers will be marked on accuracy, use of the course material and clarity." />
        </label>
        <div className="ex-grid">
          <label className="ex-field">
            <span>Terms it lists, one per line</span>
            <textarea className="ex-input ex-area" rows={3} value={d.terms.join("\n")} onChange={(e) => set({ terms: lines(e.target.value) })} />
          </label>
          <label className="ex-field">
            <span>Sample questions, one per line</span>
            <textarea className="ex-input ex-area" rows={3} value={d.sampleQuestions.join("\n")} onChange={(e) => set({ sampleQuestions: lines(e.target.value) })} />
          </label>
        </div>
    </>
  );
}
