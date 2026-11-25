"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GAP, LEFT, NARROW, RAIL, RIGHT, clamp, paneLimits } from "@/lib/layout/panes";
import { LockControls } from "@/components/lockin/LockControls";
import { Resizer } from "./Resizer";

/**
 * The three panes: a section list on the left, the reading pane in the middle, the chat on the right.
 * Edges drag to resize (and take arrow keys); the left pane collapses to a rail. Pane width during
 * collapse is the one layout transition in the product, because animating transform would distort text.
 * It fills its parent, so it works as a whole screen or as a framed demo.
 */
export function Workspace({
  topbar,
  left,
  leftFooter,
  leftTitle = "Sections",
  listName = "section list",
  rightName = "chat",
  arrive,
  right,
  children,
}: {
  topbar?: ReactNode;
  left: ReactNode;
  leftFooter?: ReactNode;
  leftTitle?: string;
  /** What the left pane holds, for the collapse and resize labels. */
  listName?: string;
  rightName?: string;
  /** The overview's zoom just landed here: let the side panes settle once. */
  arrive?: boolean;
  /** Left out for a screen that is only a list and one sheet, such as Let's talk!. */
  right?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [leftW, setLeftW] = useState<number>(LEFT.def);
  const [rightW, setRightW] = useState<number>(RIGHT.def);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(1440);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    // Below ~1180px the list starts collapsed to give the reading pane room. Decided once, on first measure.
    if (el.clientWidth < NARROW) {
      setCollapsed(true);
      setRightW(340);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { leftMax, rightMax } = paneLimits(width, collapsed ? RAIL : leftW, right ? rightW : 0);
  const leftCol = collapsed ? RAIL : clamp(leftW, LEFT.min, leftMax);
  const rightCol = right ? clamp(rightW, RIGHT.min, rightMax) : 0;

  return (
    <div className="m-ws m-desk" data-with-topbar={topbar ? "" : undefined} data-dragging={dragging ? "" : undefined} data-arrive={arrive ? "" : undefined} ref={root}>
      {topbar && (
        <header className="m-topbar">
          {topbar}
          <LockControls />
        </header>
      )}
      <div className="m-panes" style={{ gridTemplateColumns: right ? `${leftCol}px ${GAP}px minmax(0, 1fr) ${GAP}px ${rightCol}px` : `${leftCol}px ${GAP}px minmax(0, 1fr)` }}>
        <div className="m-left" data-collapsed={collapsed ? "" : undefined}>
          <div className="m-left-head">
            {!collapsed && <h2>{leftTitle}</h2>}
            <button
              type="button"
              className="m-icon-btn"
              aria-label={collapsed ? `Show the ${listName}` : `Hide the ${listName}`}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path d="M6 3v10" stroke="currentColor" strokeWidth="1.4" />
                {!collapsed && <path d="M3.5 6v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
              </svg>
            </button>
          </div>
          {!collapsed && (
            <>
              {left}
              {leftFooter && <div className="m-left-foot">{leftFooter}</div>}
            </>
          )}
        </div>

        {collapsed ? (
          <span />
        ) : (
          <Resizer label={`Resize the ${listName}`} value={leftCol} min={LEFT.min} max={leftMax} onChange={setLeftW} onDragState={setDragging} />
        )}

        {children}

        {right && (
          <>
            <Resizer label={`Resize the ${rightName}`} value={rightCol} min={RIGHT.min} max={rightMax} onChange={setRightW} onDragState={setDragging} invert />
            {right}
          </>
        )}
      </div>
    </div>
  );
}
