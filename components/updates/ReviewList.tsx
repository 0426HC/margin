"use client";

import { TYPE_CHOICES, type FileType } from "@/lib/projects/file-kinds";
import { WeekSelect } from "./WeekSelect";
import type { RemovedItem, ReviewItem, WeekRow } from "./types";

const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
/** What happens to a file that isn't a lecture or reading, said plainly. */
const WHERE_IT_GOES: Partial<Record<FileType, (w: number | null) => string>> = {
  optional: (w) => `It goes beside the ${w ? `week ${w} ` : ""}layer it fits, labelled optional.`,
  "my-notes": (w) => (w ? `Copied into week ${w}'s Lecture notes, below anything already there.` : "Pick a week to copy it into that week's Lecture notes."),
  syllabus: () => "Kept as the course's syllabus, never a layer.",
  exam: () => "Kept for the exam room; nothing is practised from it yet.",
};

function ItemRow({ item, weeks, onChange }: { item: ReviewItem; weeks: WeekRow[]; onChange: (p: Partial<ReviewItem>) => void }) {
  const id = `upd-${item.key}`;
  const where = item.type ? WHERE_IT_GOES[item.type]?.(item.week) : null;
  return (
    <li className="upd-item" data-skipped={item.include ? undefined : ""}>
      <input
        id={id}
        type="checkbox"
        className="upd-check-box"
        checked={item.include}
        disabled={!!item.error}
        onChange={(e) => onChange({ include: e.target.checked })}
        aria-label={`Include ${item.name}`}
      />
      <label htmlFor={id} className="upd-name">
        {item.name}
        {folderOf(item.relPath) && <small>{folderOf(item.relPath)}</small>}
      </label>
      {!item.error && (
        <span className="upd-controls">
          <select className="upd-select" aria-label={`Type of ${item.name}`} value={item.type ?? ""} onChange={(e) => e.target.value && onChange({ type: e.target.value as FileType, check: false, reason: "You set this." })}>
            {!item.type && <option value="">Choose a type</option>}
            {TYPE_CHOICES.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          {item.type !== "syllabus" && <WeekSelect weeks={weeks} value={item.week} onChange={(week) => onChange({ week, check: false, reason: "You set this." })} label={`Week for ${item.name}`} />}
        </span>
      )}
      {item.error ? (
        <p className="upd-note" data-bad role="alert">
          {item.error}
        </p>
      ) : (
        <p className="upd-note">
          {item.check && (
            <span className="m-check" title="Claude wasn't sure about this file. Change its week or type if they're wrong.">
              check this
            </span>
          )}
          {item.type ? item.reason : `${item.reason ? `${item.reason} ` : ""}Choose its type and week.`}
          {where ? ` ${where}` : ""}
        </p>
      )}
    </li>
  );
}

/** The "What's new" list: New, Changed, Removed and Exam sheet. Each item can be included or skipped; nothing is written until the student approves. */
export function ReviewList({
  items,
  removed,
  weeks,
  unchanged,
  skippedKinds,
  onItem,
  onRemoved,
}: {
  items: ReviewItem[];
  removed: RemovedItem[];
  weeks: WeekRow[];
  unchanged: number;
  skippedKinds: number;
  onItem: (key: string, p: Partial<ReviewItem>) => void;
  onRemoved: (id: string, p: Partial<RemovedItem>) => void;
}) {
  const fresh = items.filter((i) => i.group === "new" && i.type !== "exam");
  const changed = items.filter((i) => i.group === "changed" && i.type !== "exam");
  const exams = items.filter((i) => i.type === "exam");
  const waiting = weeks.filter((w) => w.waiting).map((w) => w.week);
  const none = !items.length && !removed.length;
  return (
    <>
      <p className="upd-summary" role="status">
        <span>{unchanged} unchanged, skipped</span>
        {skippedKinds > 0 && <span>{skippedKinds} not a type Margin reads</span>}
        {waiting.length > 0 && <span>Waiting for files: {waiting.map((w) => `Week ${w}`).join(", ")}</span>}
      </p>
      {none && <p className="upd-lede">Nothing is new. Every file here is already in the course.</p>}
      <div className="upd-groups">
        {fresh.length > 0 && (
          <section className="upd-group" aria-label="New files">
            <h3>
              New<span>{fresh.length}</span>
            </h3>
            <ul className="upd-list">
              {fresh.map((i) => (
                <ItemRow key={i.key} item={i} weeks={weeks} onChange={(p) => onItem(i.key, p)} />
              ))}
            </ul>
          </section>
        )}
        {changed.length > 0 && (
          <section className="upd-group" aria-label="Changed files">
            <h3>
              Changed<span>{changed.length}</span>
            </h3>
            <ul className="upd-list">
              {changed.map((i) => (
                <ItemRow key={i.key} item={i} weeks={weeks} onChange={(p) => onItem(i.key, p)} />
              ))}
            </ul>
          </section>
        )}
        {removed.length > 0 && (
          <section className="upd-group" aria-label="Removed files">
            <h3>
              Removed<span>{removed.length}</span>
            </h3>
            <ul className="upd-list">
              {removed.map((r) => (
                <li key={r.id} className="upd-item" data-skipped={r.include ? undefined : ""}>
                  <input
                    type="checkbox"
                    id={`upd-rm-${r.id}`}
                    checked={r.include}
                    onChange={(e) => onRemoved(r.id, { include: e.target.checked })}
                    aria-label={`Include ${r.name}`}
                  />
                  <label htmlFor={`upd-rm-${r.id}`} className="upd-name">
                    {r.name}
                    <small>{folderOf(r.relPath) || "no folder"}</small>
                  </label>
                  <span className="upd-controls">
                    <select
                      className="upd-select"
                      aria-label={`What to do with the passages of ${r.name}`}
                      value={r.keep ? "keep" : "remove"}
                      disabled={!r.include}
                      onChange={(e) => onRemoved(r.id, { keep: e.target.value === "keep" })}
                    >
                      <option value="keep">Keep its passages</option>
                      <option value="remove">Remove its passages</option>
                    </select>
                  </span>
                  <p className="upd-note">
                    No longer in the folder.{" "}
                    {r.passages
                      ? `${r.passages} ${r.passages === 1 ? "passage" : "passages"} in ${r.layers} ${r.layers === 1 ? "layer" : "layers"}.`
                      : "None of its text is in a layer."}{" "}
                    {r.include
                      ? r.keep
                        ? "Its text stays, and your write-ups are untouched."
                        : "Its text leaves the layers. Your write-ups are untouched."
                      : "Left as it is for now."}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {exams.length > 0 && (
          <section className="upd-group" aria-label="Exam material">
            <h3>
              Exam material<span>{exams.length}</span>
            </h3>
            <ul className="upd-list">
              {exams.map((i) => (
                <ItemRow key={i.key} item={i} weeks={weeks} onChange={(p) => onItem(i.key, p)} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
