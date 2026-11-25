import type { WeekRow } from "./types";

export const weekLabel = (w: WeekRow) => `Week ${w.week}${w.date ? ` · ${w.date}` : ""}${w.waiting ? " · waiting for files" : ""}`;

/** Every week of the course. "Waiting" marks the weeks that have no files yet. */
export function WeekSelect({
  id,
  weeks,
  value,
  onChange,
  label,
  undecided,
  noWeek = "No week yet",
}: {
  id?: string;
  weeks: WeekRow[];
  value: number | null;
  onChange: (w: number | null) => void;
  label: string;
  undecided?: string;
  noWeek?: string;
}) {
  return (
    <select
      id={id}
      className="upd-select"
      aria-label={label}
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      <option value="">{undecided ?? noWeek}</option>
      {weeks.map((w) => (
        <option key={w.week} value={w.week}>
          {weekLabel(w)}
        </option>
      ))}
    </select>
  );
}
