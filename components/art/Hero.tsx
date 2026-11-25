import { useId, type ReactNode, type Ref } from "react";

/**
 * The Margin hero: the margin line from notebook paper, come to life. A short, plump plum bar (20 x 44 at base size, fully rounded ends)
 * with a darker stripe down its right side, two round eyes, and a soft shadow underneath. No mouth, no arms, no legs. It gets around by
 * hopping. To think, it tilts back a little and three small dots appear above it.
 *
 * Drawn in its own units with the feet at (0, 0), so a scene places it by the point it stands on. Scenes that move it keep a ref to the
 * outer group and call `applyPose` from their animation frame (CSS transform and opacity only); nothing re-renders while it moves.
 */
export interface Pose {
  x: number;
  y: number;
  /** How far it is off the ground, in hero units (it hops). */
  lift: number;
  /** Degrees; thinking is about -10. */
  tilt: number;
  /** 0 to 1: how visible the thinking dots are. */
  think: number;
}

export const HERO = { w: 20, h: 44 } as const;
export const THINK_TILT = -10;

export function Hero({
  x,
  y,
  tilt = 0,
  thinking = false,
  lift = 0,
  scale = 1,
  dots = "#97a3bd",
  heroRef,
  children,
}: {
  x: number;
  y: number;
  tilt?: number;
  thinking?: boolean;
  lift?: number;
  /** Size relative to the base 20 x 44. */
  scale?: number;
  /** Colour of the thinking dots: light on the desk, darker on paper. */
  dots?: string;
  heroRef?: Ref<SVGGElement>;
  /** Anything it carries above its head (the exam room's pencil); it tilts with the body. */
  children?: ReactNode;
}) {
  const clip = `hero-${useId().replace(/:/g, "")}`;
  const { w, h } = HERO;
  return (
    <g className="hero" ref={heroRef} data-scale={scale} style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }} aria-hidden="true">
      <ellipse className="hero-shadow" data-part="shadow" cx={0} cy={0} rx={12} ry={3.4} style={{ transform: shadowOf(lift) }} />
      <g data-part="body" style={{ transform: bodyOf(lift, tilt) }}>
        <clipPath id={clip}>
          <rect x={-w / 2} y={-h} width={w} height={h} rx={w / 2} />
        </clipPath>
        <rect x={-w / 2} y={-h} width={w} height={h} rx={w / 2} className="hero-body" />
        <rect x={w / 2 - 7} y={-h} width={7} height={h} className="hero-stripe" clipPath={`url(#${clip})`} />
        <circle cx={-4.3} cy={-34.5} r={3.7} className="hero-eye" />
        <circle cx={4.3} cy={-34.5} r={3.7} className="hero-eye" />
        <circle cx={-3.6} cy={-34.2} r={1.65} className="hero-pupil" />
        <circle cx={5} cy={-34.2} r={1.65} className="hero-pupil" />
        {children}
      </g>
      <g data-part="think" style={{ opacity: thinking ? 1 : 0, transform: `translate(0px, ${-lift}px)` }} fill={dots}>
        <circle cx={7} cy={-50} r={1.5} className="hero-dot" />
        <circle cx={11.5} cy={-56} r={1.9} className="hero-dot" />
        <circle cx={17} cy={-62.5} r={2.3} className="hero-dot" />
      </g>
    </g>
  );
}

const bodyOf = (lift: number, tilt: number) => `translate(0px, ${-lift}px) rotate(${tilt}deg)`;
// the shadow shrinks and fades a little as the hero leaves the ground
const shadowOf = (lift: number) => `scale(${Math.max(0.55, 1 - lift / 50)})`;

const parts = new WeakMap<SVGGElement, { body: SVGGElement; think: SVGGElement; shadow: SVGEllipseElement; scale: number; last: string }>();

/** Moves the hero to a pose: transforms and opacity only, written straight to the DOM. */
export function applyPose(el: SVGGElement | null, p: Pose) {
  if (!el) return;
  let q = parts.get(el);
  if (!q) {
    q = {
      body: el.querySelector('[data-part="body"]') as SVGGElement,
      think: el.querySelector('[data-part="think"]') as SVGGElement,
      shadow: el.querySelector('[data-part="shadow"]') as SVGEllipseElement,
      scale: Number(el.dataset.scale ?? 1),
      last: "",
    };
    parts.set(el, q);
  }
  // standing still costs nothing: nothing is written when the pose hasn't changed
  const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.lift.toFixed(2)},${p.tilt.toFixed(2)},${p.think.toFixed(3)}`;
  if (key === q.last) return;
  q.last = key;
  el.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) scale(${q.scale})`;
  q.body.style.transform = bodyOf(p.lift, p.tilt);
  q.shadow.style.transform = shadowOf(p.lift);
  q.think.style.opacity = p.think.toFixed(3);
  q.think.style.transform = `translate(0px, ${-p.lift}px)`;
}
