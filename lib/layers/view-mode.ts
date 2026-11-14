import { and, eq, like } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";

export type ViewMode = "explained" | "source";
const key = (layerId: string) => `view:${layerId}`;

/** The tab the student last used on each layer. Explained until they choose otherwise. */
export function getViewModes(db: Db, projectId: string): Record<string, ViewMode> {
  const out: Record<string, ViewMode> = {};
  for (const r of db.select().from(s.uiState).where(and(eq(s.uiState.projectId, projectId), like(s.uiState.key, "view:%"))).all()) {
    if (r.value === "source" || r.value === "explained") out[r.key.slice(5)] = r.value;
  }
  return out;
}

export function setViewMode(db: Db, projectId: string, layerId: string, mode: ViewMode) {
  db.insert(s.uiState)
    .values({ id: `${projectId}:${key(layerId)}`, projectId, key: key(layerId), value: mode })
    .onConflictDoUpdate({ target: [s.uiState.projectId, s.uiState.key], set: { value: mode } })
    .run();
}
