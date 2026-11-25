"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import "@/components/art/art.css";
import { ExamDeskArt } from "@/components/art/ExamDeskArt";
import { Button } from "@/components/ui/Button";

const STEPS = ["Margin reads the format, time and sections.", "It writes practice questions from your course.", "You answer, and get feedback against the marking guide."];

/**
 * The exam room before any sheet is added: the empty room (the desk, a blank paper, the hero pondering on it), a place to drop the sheet, what happens
 * next, and the demo exam to try it first. The demo course is read-only, so it offers only the demo exam.
 */
export function EmptyRoom({ isDemo, busy, onFile, onChoose, onError }: { isDemo: boolean; busy: boolean; onFile: (f: File) => void; onChoose: () => void; onError: (e: string | null) => void }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [opening, setOpening] = useState(false);
  const tryDemo = async () => {
    setOpening(true);
    onError(null);
    try {
      const r = await fetch("/api/demo/exam", { method: "POST" });
      const data = (await r.json().catch(() => null)) as { projectId?: string; examId?: string; error?: string } | null;
      if (!r.ok || !data?.projectId) throw new Error(data?.error ?? "Margin couldn't open the demo exam. Try again.");
      router.push(`/p/${data.projectId}/exam?e=${data.examId}`);
      router.refresh();
    } catch (e) {
      setOpening(false);
      onError(e instanceof Error ? e.message : "Margin couldn't open the demo exam. Try again.");
    }
  };
  return (
    <div className="ex-empty-room">
      <div className="ex-empty-art">
        <ExamDeskArt blank label="An empty exam room: a wooden desk with a blank paper, and the Margin hero standing on it" />
      </div>
      <div className="ex-empty-side">
        {!isDemo && (
          <div
            className="ex-drop"
            data-over={over ? "" : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
          >
            <p className="ex-drop-title">Drop your exam sheet here</p>
            <p className="ex-drop-line">The instructions your professor gave you: PDF or Word.</p>
            <Button variant="accent" onClick={onChoose} disabled={busy}>
              {busy ? "Adding…" : "Choose a file"}
            </Button>
          </div>
        )}
        <ol className="ex-steps">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {isDemo ? (
          <Button variant="accent" onClick={() => void tryDemo()} disabled={opening}>
            {opening ? "Opening the demo exam…" : "Try the demo exam"}
          </Button>
        ) : (
          <button type="button" className="ex-demo-link" onClick={() => void tryDemo()} disabled={opening}>
            {opening ? "Opening the demo exam…" : "Or try the demo exam"}
          </button>
        )}
      </div>
    </div>
  );
}
