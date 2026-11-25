"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "./api";

/** "This course has __ weeks." Saved when the field is left or Enter is pressed. Lecture notes, the Weeks view and week labels follow it. */
export function WeekCountField({ projectId, weekCount, onSaved }: { projectId: string; weekCount: number | null; onSaved?: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(weekCount ? String(weekCount) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    const n = Number(value);
    if (!value.trim() || n === weekCount) return;
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      setError("Type a whole number of weeks, from 1 to 60.");
      return;
    }
    setError(null);
    const err = await call(`/api/projects/${projectId}`, "PATCH", { weekCount: n });
    if (err) setError(err);
    else {
      setSaved(true);
      onSaved?.();
      router.refresh();
    }
  }

  return (
    <div className="m-weekcount">
      <label className="m-weekcount-label">
        This course has
        <input
          className="m-weekcount-input"
          inputMode="numeric"
          aria-label="Number of weeks in this course"
          value={value}
          placeholder="?"
          onChange={(e) => {
            setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
            setSaved(false);
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        weeks
      </label>
      <span className={error ? "m-field-error" : "m-weekcount-saved"} role={error ? "alert" : "status"}>
        {error ?? (saved ? "Saved" : "")}
      </span>
    </div>
  );
}
