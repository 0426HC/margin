// Survives a client-side navigation, so the next page knows how the last one ended.
export type Rect = { x: number; y: number; w: number; h: number };
export const transit: {
  /** "in": a tile opened a project. "out": the project's wordmark went back to the landing page. */
  dir: "in" | "out" | null;
  projectId: string;
  /** Where the tile sat when it was clicked. */
  rect: Rect | null;
} = { dir: null, projectId: "federalist", rect: null };
