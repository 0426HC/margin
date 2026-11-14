"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId, useRef } from "react";

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * A segmented control with a sliding thumb. It is a tablist: arrow keys move between options.
 * With reduced motion the thumb jumps instead of sliding.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  idPrefix,
  panelId,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idPrefix: string;
  panelId: string;
}) {
  const reduced = useReducedMotion();
  const group = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    let next = i;
    if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "ArrowRight") next = Math.min(options.length - 1, i + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[options[next].value]?.focus();
  }

  return (
    <LayoutGroup id={group}>
      <div className="m-seg" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[o.value] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-${o.value}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              className="m-seg-btn"
              onClick={() => onChange(o.value)}
            >
              {active && (
                <motion.span
                  layoutId="thumb"
                  className="m-seg-thumb"
                  transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.32, bounce: 0.12 }}
                />
              )}
              <span className="m-seg-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
