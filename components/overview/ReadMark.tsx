import { BookCheck } from "lucide-react";

/** The small mark beside a week the course brain has read in full. Quiet: the label colour, no motion; its words are there for screen readers and on hover. */
export function ReadMark() {
  return (
    <span className="read-mark" title="Margin has read this week">
      <BookCheck aria-hidden="true" size={13} strokeWidth={1.75} />
      <span className="read-mark-words">Margin has read this week</span>
    </span>
  );
}
