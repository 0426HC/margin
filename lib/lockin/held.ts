/**
 * Agent updates, as "While you were away" shows them: one line per kind of work (the latest run says what is there now), and each
 * document its own line. Lock in holds these back and only counts them, so the count is always the number of lines that will show.
 */
export type UpdateTask = { id: string; agent: string; kind: string };

export function updateLines<T extends UpdateTask>(unseen: T[]): T[] {
  return [...new Map(unseen.map((t) => [t.kind === "make-document" ? t.id : `${t.agent}:${t.kind}`, t])).values()];
}

/** "1 update waiting", "2 updates waiting"; nothing when there are none. */
export function waitingLabel(n: number): string | null {
  return n > 0 ? `${n} ${n === 1 ? "update" : "updates"} waiting` : null;
}
