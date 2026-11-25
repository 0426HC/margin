"use client";

import { useRef } from "react";
import { clamp, nudge } from "@/lib/layout/panes";

/**
 * A drag handle between panes. Drag with a pointer, or focus it and use the arrow keys
 * (Shift for bigger steps). `invert` is for a pane that grows when the handle moves left.
 */
export function Resizer({
  label,
  value,
  min,
  max,
  onChange,
  onDragState,
  invert = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  onDragState?: (dragging: boolean) => void;
  invert?: boolean;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="m-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: value };
        onDragState?.(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = e.clientX - start.current.x;
        onChange(clamp(start.current.w + (invert ? -d : d), min, max));
      }}
      onPointerUp={() => {
        start.current = null;
        onDragState?.(false);
      }}
      onKeyDown={(e) => {
        const next = nudge(value, e.key, e.shiftKey, min, max, invert);
        if (next !== value) {
          e.preventDefault();
          onChange(next);
        }
      }}
    >
      <span />
    </div>
  );
}
