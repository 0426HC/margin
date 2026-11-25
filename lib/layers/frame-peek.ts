/**
 * What the layer workspace can show before the layer itself arrives (`LayerFrame`): the course's structure, kept from the page that had it
 * (the course page or the layer before), and which layer is being opened, noted when its link is followed. Browser only; in memory,
 * with the structures also kept for this tab's session so a reload can use them. Nothing here is ever sent anywhere.
 */
import type { StructureModel } from "./types";

const KEY = "margin:frame-models";
const models = new Map<string, StructureModel>();
let opening: { projectId: string; layerId: string } | null = null;
/** Bumped whenever what framePeek would answer may have changed, so it can hand back the same answer until then. */
let version = 0;
let last: { key: string; value: ReturnType<typeof peek> } | null = null;

const LAYER_PATH = /^\/p\/([^/?#]+)\/l\/([^/?#]+)/;

/** Keep a course's structure, so a layer of it opened next can draw its frame at once. */
export function rememberCourse(model: StructureModel) {
  if (models.get(model.project.id) === model) return;
  models.set(model.project.id, model);
  version++;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(models)));
  } catch {
    // private window or storage full: the in-memory copy is enough
  }
}

/** Note the layer a link or a push is about to open (any address; ones that aren't a layer are ignored). */
export function noteOpening(href: string | null | undefined) {
  const m = href ? LAYER_PATH.exec(href.replace(/^https?:\/\/[^/]+/, "")) : null;
  if (m) {
    opening = { projectId: m[1], layerId: m[2] };
    version++;
  }
}

/** A layer link was clicked anywhere on the page: note it before the route changes. For a capture-phase click listener. */
export function noteClickedLink(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (a) noteOpening(a.getAttribute("href"));
}

function stored(projectId: string): StructureModel | null {
  const had = models.get(projectId);
  if (had) return had;
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, StructureModel>;
    if (all[projectId]) models.set(projectId, all[projectId]);
    return all[projectId] ?? null;
  } catch {
    return null;
  }
}

/** The layer being opened (noted, or else read from the address) and its course's structure, if Margin has them. The same object until either changes. */
export function framePeek() {
  const key = `${version}:${typeof location !== "undefined" ? location.pathname : ""}`;
  if (last?.key !== key) last = { key, value: peek() };
  return last.value;
}

function peek(): { projectId: string; layerId: string; model: StructureModel | null } | null {
  const here = typeof location !== "undefined" ? LAYER_PATH.exec(location.pathname) : null;
  const target = opening ?? (here ? { projectId: here[1], layerId: here[2] } : null);
  if (!target) return null;
  const model = stored(target.projectId);
  return { ...target, model: model && model.weeks.some((w) => w.layers.some((l) => l.id === target.layerId)) ? model : null };
}

/** The layer arrived: what was noted for it is spent. */
export function openingDone(layerId: string) {
  if (opening?.layerId !== layerId) return;
  opening = null;
  version++;
}
