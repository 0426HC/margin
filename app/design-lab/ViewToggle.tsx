"use client";

import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import type { Mode } from "./data";

const options: { value: Mode; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "explained", label: "Explained" },
];

export function ViewToggle({
  value,
  onChange,
  panelId,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
  panelId: string;
}) {
  const reduced = useReducedMotion();
  const refs = useRef<Record<Mode, HTMLButtonElement | null>>({ original: null, explained: null });

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: Mode = e.key === "ArrowLeft" || e.key === "Home" ? "original" : "explained";
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <LayoutGroup id="view-toggle">
      <div className="seg" role="tablist" aria-label="Show this section as" onKeyDown={onKeyDown}>
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
              id={`tab-${o.value}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              className="seg-btn"
              onClick={() => onChange(o.value)}
            >
              {active && (
                <motion.span
                  layoutId="seg-thumb"
                  className="seg-thumb"
                  transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.32, bounce: 0.12 }}
                />
              )}
              <span className="seg-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
