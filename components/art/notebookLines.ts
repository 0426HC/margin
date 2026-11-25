/** The left page of the Note to Self notebook, in page units (u right, v down). The margin line runs down at MARGIN_U. */
export const PAGE = { w: 112, h: 150 } as const;
export const MARGIN_U = 14;
const TOP = 20;
const BOTTOM = 14;
const LENGTHS = [80, 72, 84, 66, 78, 70, 82, 60, 76, 68, 84, 74];

export interface Row {
  v: number;
  /** Where the written line starts (just right of the margin) and how long it is. */
  u0: number;
  len: number;
}

/** One ruled row per layer of the course: the written lines sit on them, one per layer saved. Spacing shrinks for a long course. */
export function notebookRows(total: number): { rows: Row[]; gap: number } {
  const n = Math.max(total, 0);
  const gap = n > 1 ? Math.min(12, (PAGE.h - TOP - BOTTOM) / (n - 1)) : 12;
  const rows = Array.from({ length: n }, (_, i) => ({ v: TOP + i * gap, u0: MARGIN_U + 3, len: LENGTHS[i % LENGTHS.length] - (gap < 9 ? 6 : 0) }));
  return { rows, gap };
}

/** How many lines to draw instantly (seen before) and which ones to write with the hero. A layer removed from Note to Self lowers `seen`. */
export function linesPlan(saved: number, seen: number | null): { instant: number; write: number[] } {
  const s = Math.max(0, saved);
  const instant = seen === null ? 0 : Math.min(Math.max(0, seen), s);
  return { instant, write: Array.from({ length: s - instant }, (_, i) => instant + i) };
}

export const seenKey = (projectId: string) => `margin:note-lines-seen:${projectId}`;

export function readSeen(projectId: string): number | null {
  try {
    const v = window.localStorage.getItem(seenKey(projectId));
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}

export function writeSeen(projectId: string, n: number) {
  try {
    window.localStorage.setItem(seenKey(projectId), String(n));
  } catch {
    /* private window: the lines are written again next time, which is fine */
  }
}
