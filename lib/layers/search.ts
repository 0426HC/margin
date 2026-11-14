import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { searchPassages } from "@/lib/db/search";

export interface FileHit {
  layerId: string | null;
  layerTitle: string | null;
  partKey: "A" | "B" | null;
  file: string;
  page: number;
  snippet: string;
}

const snippetOf = (text: string, n = 160) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

/** Search the project's files (BM25) and say which layer each hit sits in, so a result can open the layer. */
export function searchProject(db: Db, projectId: string, query: string, k = 6): FileHit[] {
  const hits = searchPassages(db, projectId, query, k);
  if (!hits.length) return [];
  const rows = db
    .select({ passageId: s.layerPassages.passageId, layerId: s.layers.id, title: s.layers.title, key: s.parts.key })
    .from(s.layerPassages)
    .innerJoin(s.layers, eq(s.layers.id, s.layerPassages.layerId))
    .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
    .where(inArray(s.layerPassages.passageId, hits.map((h) => h.passageId)))
    .all();
  const byPassage = new Map(rows.map((r) => [r.passageId, r]));
  return hits.map((h) => {
    const l = byPassage.get(h.passageId);
    return { layerId: l?.layerId ?? null, layerTitle: l?.title ?? null, partKey: l?.key ?? null, file: h.file, page: h.page, snippet: snippetOf(h.text) };
  });
}
