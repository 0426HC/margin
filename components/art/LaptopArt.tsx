"use client";

import { memo, useEffect, useRef } from "react";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Hero, applyPose } from "./Hero";
import { box, iso, onTilted, onTop, pts } from "./iso";
import { KEY, SPACE, keys as allKeys, pickKey, seeded, type Key } from "./keyHops";
import { useSceneLive } from "./live";
import { Script, call, hop, useFrameLoop, wait } from "./rig";

const W = 300; // the laptop's width (along x)
const D = 196; // depth of the base (along y)
const T = 9; // thickness of the base
const LID = 198; // height of the lid
const TILT = 12; // how far the lid leans back

const SCALE = 0.55;
const KEYS = allKeys();
const HOME = KEYS.find((k) => k.id === "2:6") as Key;
const onKey = (k: Key) => {
  const [x, y] = iso(k.u, k.v, T);
  return { x, y };
};

/**
 * Let's talk!: an isometric laptop showing a small, simplified Let's talk! page: the top bar, the title, the tabs with Chat filled in,
 * one message from you and the professor typing. The page is drawn flat and laid onto the screen with one matrix, so it sits in perspective.
 * The hero hops from key to key, mostly on the letter keys in the middle, sometimes the space bar: 0.3 s a hop, a very short stop on each key,
 * now and then a longer pause. The typing dots keep going; nothing is typed. Still under reduced motion.
 */
export const LaptopArt = memo(function LaptopArt({ course }: { course: string }) {
  const reduced = useReducedSafe();
  const live = useSceneLive();
  const hero = useRef<SVGGElement>(null);
  const script = useRef<Script | null>(null);
  const base = box(0, 0, 0, W, D, T);
  const [cx, cy] = iso(W / 2, D / 2, 0);
  const keys = [];
  for (let row = 0; row < KEY.rows; row++)
    for (let col = 0; col < KEY.cols; col++) {
      if (row === KEY.rows - 1 && col >= SPACE.from && col <= SPACE.to) continue;
      keys.push(<rect key={`${row}:${col}`} x={KEY.u0 + col * KEY.pitchU} y={KEY.v0 + row * KEY.pitchV} width={KEY.w} height={KEY.h} rx={2} className="art-key" />);
    }
  keys.push(<rect key="space" x={KEY.u0 + SPACE.from * KEY.pitchU} y={KEY.v0 + (KEY.rows - 1) * KEY.pitchV} width={(SPACE.to - SPACE.from) * KEY.pitchU + KEY.w} height={KEY.h} rx={2} className="art-key" />);
  const home = onKey(HOME);

  useEffect(() => {
    if (reduced) {
      script.current = null;
      applyPose(hero.current, { ...home, lift: 0, tilt: 0, think: 0 });
      return;
    }
    const rand = seeded(11);
    let at = HOME;
    script.current = new Script({ ...home, lift: 0, tilt: 0, think: 0 }, () => {
      const next = pickKey(KEYS, at, rand);
      const stop = rand() < 0.12 ? 1 : 0.06 + rand() * 0.08;
      return [hop(onKey(next), 0.3, 13), call(() => void (at = next)), wait(stop)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- home is a constant
  }, [reduced]);
  useFrameLoop(live && !reduced, (dt) => script.current && applyPose(hero.current, script.current.tick(dt)));
  return (
    <svg viewBox="-200 -250 520 520" className="art-svg art-laptop" role="img" aria-label="A laptop open on Let’s talk!: you wrote “Hi, let’s discuss!” and the professor is typing. The Margin hero hops across the keys.">
      <defs>
        <radialGradient id="art-laptop-shadow">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy + 14} rx={260} ry={130} fill="url(#art-laptop-shadow)" />

      {/* base */}
      <polygon points={base.front} className="art-lap-front" />
      <polygon points={base.side} className="art-lap-side" />
      <polygon points={base.top} className="art-lap-top" />
      <g transform={onTop(0, 0, T)}>
        <rect x={12} y={9} width={W - 24} height={98} rx={5} className="art-key-well" />
        {keys}
        <rect x={W * 0.33} y={122} width={W * 0.34} height={58} rx={6} className="art-pad" />
      </g>

      {/* lid: a thin edge, the body, the bezel, then the screen */}
      <polygon points={pts([0, 0, T], [W, 0, T], [W, -3, T + 2], [0, -3, T + 2])} className="art-lap-side" />
      <g transform={onTilted(0, 0, T, LID, TILT)}>
        <rect x={0} y={0} width={W} height={LID} rx={9} className="art-lid" />
        <rect x={7} y={7} width={W - 14} height={LID - 14} rx={5} className="art-bezel" />
        <g className="art-screen">
          <rect x={13} y={13} width={W - 26} height={LID - 26} rx={2} className="art-scr-paper" />
          <path d={`M13 15 a2 2 0 0 1 2 -2 H${W - 15} a2 2 0 0 1 2 2 V31 H13 z`} className="art-scr-bar" />
          <text x={22} y={26} className="art-scr-brand">
            Margin
          </text>
          <text x={58} y={25.5} className="art-scr-course">
            {course.length > 34 ? `${course.slice(0, 33)}…` : course}
          </text>
          <text x={24} y={52} className="art-scr-title">
            Let&rsquo;s talk!
          </text>
          <rect x={24} y={60} width={34} height={13} rx={3} className="art-scr-tab-on" />
          <text x={41} y={69.5} className="art-scr-tab art-scr-tab-label-on" textAnchor="middle">
            Chat
          </text>
          <text x={80} y={69.5} className="art-scr-tab" textAnchor="middle">
            Sources
          </text>
          <text x={124} y={69.5} className="art-scr-tab" textAnchor="middle">
            Notepad
          </text>
          <line x1={24} x2={W - 24} y1={78.5} y2={78.5} className="art-scr-rule" />
          <rect x={W - 24 - 92} y={88} width={92} height={20} rx={8} className="art-scr-you" />
          <text x={W - 24 - 46} y={101.5} className="art-scr-msg" textAnchor="middle">
            Hi, let&rsquo;s discuss!
          </text>
          <rect x={24} y={116} width={40} height={20} rx={8} className="art-scr-prof" />
          <g className="art-typing">
            <circle cx={35} cy={126} r={2.4} className="art-dot" />
            <circle cx={44} cy={126} r={2.4} className="art-dot" />
            <circle cx={53} cy={126} r={2.4} className="art-dot" />
          </g>
          <rect x={24} y={LID - 13 - 30} width={W - 48} height={19} rx={4} className="art-scr-input" />
          <text x={32} y={LID - 13 - 17} className="art-scr-ph">
            Ask your professor
          </text>
        </g>
      </g>
      <Hero heroRef={hero} x={home.x} y={home.y} scale={SCALE} />
    </svg>
  );
});
