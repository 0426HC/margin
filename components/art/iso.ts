// Isometric drawing for the scene illustrations: x runs down-right, y down-left, both at 30 degrees, z straight up.
// Shapes are flat polygons; flat drawings (a screen, a sheet of text, a sweater) are laid onto a plane with one SVG matrix.
export const C = Math.cos(Math.PI / 6);
export const S = 0.5;

export type P3 = [number, number, number];

export const iso = (x: number, y: number, z: number): [number, number] => [(x - y) * C, (x + y) * S - z];

const r = (n: number) => Math.round(n * 10) / 10;

/** An SVG points list for a polygon given in world coordinates. */
export const pts = (...p: P3[]) => p.map(([x, y, z]) => iso(x, y, z).map(r).join(",")).join(" ");

/** A box's three visible faces (top, front facing +y, side facing +x), from its near-origin corner and size. */
export function box(x: number, y: number, z: number, w: number, d: number, h: number) {
  return {
    top: pts([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]),
    front: pts([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]),
    side: pts([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]),
  };
}

/** Lays a flat drawing (u right, v down) onto the horizontal plane at height z, with its top-left corner at (x, y). u runs along x, v along y. */
export const onTop = (x: number, y: number, z: number) => `matrix(${r4(C)} ${S} ${r4(-C)} ${S} ${r((x - y) * C)} ${r((x + y) * S - z)})`;

/**
 * Lays a flat drawing onto a plane that stands at y = y0 and leans back by `tilt` degrees from upright (a laptop screen), hinged at height z0.
 * The drawing is `h` tall; its top edge is the far edge of the lid.
 */
export function onTilted(x0: number, y0: number, z0: number, h: number, tilt: number) {
  const s = Math.sin((tilt * Math.PI) / 180);
  const c = Math.cos((tilt * Math.PI) / 180);
  // a point (u, v) sits at height (h - v) up the lid: world (x0 + u, y0 - (h - v)s, z0 + (h - v)c)
  const [ex, ey] = iso(x0, y0 - h * s, z0 + h * c);
  return `matrix(${r4(C)} ${S} ${r4(-C * s)} ${r4(S * s + c)} ${r(ex)} ${r(ey)})`;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
