"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { call } from "./api";

/** The one question Margin asks, only when nothing in the folder says how many weeks the course runs. Never a form. */
export function QuestionCard({ projectId, onAnswered }: { projectId: string; onAnswered: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function answer() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      setError("Type a whole number of weeks, from 1 to 60.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await call(`/api/projects/${projectId}`, "PATCH", { weekCount: n });
    setBusy(false);
    if (err) setError(err);
    else {
      onAnswered();
      router.refresh();
    }
  }

  return (
    <section className="m-question" aria-label="One question before the plan">
      <h2 className="m-question-q">How many weeks does this course run?</h2>
      <p className="m-question-why">Nothing in the folder says, so Margin can&rsquo;t tell. It sets the Weeks view and Lecture notes.</p>
      <form
        className="m-question-form"
        onSubmit={(e) => {
          e.preventDefault();
          void answer();
        }}
      >
        <label className="sr-only" htmlFor="m-question-input">
          Number of weeks
        </label>
        <input id="m-question-input" className="m-weekcount-input" inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} />
        <span className="m-question-prefix">weeks</span>
        <Button type="submit" variant="accent" disabled={busy || !value}>
          {busy ? "Saving" : "Continue"}
        </Button>
      </form>
      {error && (
        <p className="m-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
