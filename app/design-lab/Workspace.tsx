"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatPanel, type ChatHandle } from "./ChatPanel";
import { ReadingPane } from "./ReadingPane";
import { SectionList } from "./SectionList";
import { Palette, type Command } from "./Palette";
import { ACTIVE_ID, course, units, type Mode } from "./data";
import { useNotes } from "./notes";
import { GAP, LEFT, MIN_MID, RAIL, RIGHT, arrival } from "./panes";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function Resizer({
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
  onDragState: (d: boolean) => void;
  invert?: boolean;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="resizer"
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
        onDragState(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = e.clientX - start.current.x;
        onChange(clamp(start.current.w + (invert ? -d : d), min, max));
      }}
      onPointerUp={() => {
        start.current = null;
        onDragState(false);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") onChange(clamp(value + (invert ? step : -step), min, max));
        if (e.key === "ArrowRight") onChange(clamp(value + (invert ? -step : step), min, max));
      }}
    >
      <span />
    </div>
  );
}

export function Workspace() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [collapsed, setCollapsed] = useState(false);
  const [leftW, setLeftW] = useState(LEFT.def);
  const [rightW, setRightW] = useState(RIGHT.def);
  const [dragging, setDragging] = useState(false);
  // Arriving from the overview's zoom: open on that section, and let the panes settle in once.
  const [activeId, setActiveId] = useState(() => arrival.sectionId ?? ACTIVE_ID);
  const [arriving, setArriving] = useState(false);
  const notes = useNotes();
  const [viewCmd, setViewCmd] = useState<{ mode: Mode; n: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const chat = useRef<ChatHandle>(null);
  const [jump, setJump] = useState<{ page: number; n: number } | null>(null);
  const [width, setWidth] = useState(1440);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Next keeps this route alive in <Activity>, so this also runs each time the workspace is shown.
  useLayoutEffect(() => {
    setArriving(arrival.sectionId !== null);
    arrival.sectionId = null;
    const fromUrl = new URLSearchParams(window.location.search).get("section");
    if (fromUrl && units.some((u) => u.sections.some((s) => s.id === fromUrl))) setActiveId(fromUrl);
    return () => setArriving(false);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Below ~1180px the list starts collapsed to give the reading pane room.
  useEffect(() => {
    if (window.innerWidth < 1180) {
      setCollapsed(true);
      setRightW(340);
    }
  }, []);

  const leftCol = collapsed ? RAIL : leftW;
  const rightMax = Math.max(RIGHT.min, Math.min(RIGHT.max, width - 2 * GAP - leftCol - MIN_MID - 2 * GAP));
  const leftMax = Math.max(LEFT.min, Math.min(LEFT.max, width - 2 * GAP - rightW - MIN_MID - 2 * GAP));
  const rightCol = clamp(rightW, RIGHT.min, rightMax);

  const all = units.flatMap((u) => u.sections);
  const active = all.find((s) => s.id === activeId) ?? all[0];
  const hasContent = active.id === ACTIVE_ID;

  const onCite = useCallback((page: number) => setJump({ page, n: Date.now() }), []);

  const commands = useMemo<Command[]>(() => {
    const here = (label: string, id: string, run: () => void): Command => ({ id, group: "This section", label, run });
    return [
      here("Quiz me", "quiz", () => chat.current?.run("quiz")),
      here("Teach it back", "teach", () => chat.current?.run("teach")),
      here("Explain differently: simpler", "simpler", () => chat.current?.run("simpler")),
      here("Connect it", "connect", () => chat.current?.run("connect")),
      here("Show Original", "original", () => setViewCmd({ mode: "original", n: Date.now() })),
      here("Show Explained", "explained", () => setViewCmd({ mode: "explained", n: Date.now() })),
      ...units.flatMap((u) =>
        u.sections.map((s) => ({ id: `go-${s.id}`, group: "Go to a section", label: s.title, run: () => setActiveId(s.id) })),
      ),
    ];
  }, []);

  return (
    <div className="ws" data-theme={theme} data-dragging={dragging ? "" : undefined} data-arriving={arriving ? "" : undefined} ref={rootRef}>
      <header className="topbar">
        <span className="wordmark">Margin</span>
        <span className="project">
          <Link href="/design-lab/overview" scroll={false} className="project-link">
            {course.title}
          </Link>
          <span className="tag">Demo, read only</span>
        </span>
        <button type="button" className="kbar" onClick={() => window.dispatchEvent(new Event("ws:palette"))}>
          Search or ask <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="theme"
          aria-pressed={theme === "light"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "Walnut desk" : "Tan desk"}
        </button>
      </header>

      <div
        className="panes"
        style={{ gridTemplateColumns: `${leftCol}px ${GAP}px minmax(0, 1fr) ${GAP}px ${rightCol}px` }}
      >
        <div className="left" data-collapsed={collapsed ? "" : undefined}>
          <div className="left-head">
            {!collapsed && <h2>Sections</h2>}
            <button
              type="button"
              className="icon-btn"
              aria-label={collapsed ? "Show the section list" : "Hide the section list"}
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
              <SectionList units={units} activeId={active.id} onSelect={setActiveId} />
              <div className="left-foot">
                <button type="button" className="foot-link">
                  Review today <span className="count">2</span>
                </button>
                <button
                  type="button"
                  className="foot-link"
                  onClick={() => window.dispatchEvent(new CustomEvent("ws:palette", { detail: { notes: true } }))}
                >
                  Notes <span className="count">{notes.length}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {collapsed ? <span /> : (
          <Resizer label="Resize the section list" value={leftW} min={LEFT.min} max={leftMax} onChange={setLeftW} onDragState={setDragging} />
        )}

        <ReadingPane
          sectionId={active.id}
          title={active.title}
          status={active.status}
          why={active.why}
          hasContent={hasContent}
          jump={jump}
          viewCmd={viewCmd}
        />

        <Resizer label="Resize the chat" value={rightCol} min={RIGHT.min} max={rightMax} onChange={setRightW} onDragState={setDragging} invert />

        <ChatPanel key={active.id} title={active.title} enabled={hasContent} onCite={onCite} handle={chat} />
      </div>

      {toast && <p className="ws-toast" role="status">{toast}</p>}

      <Palette
        commands={commands}
        scopeLabel={active.title}
        onAsk={(q) => (hasContent ? chat.current?.ask(q) : setToast("This section has no text in the mockup, so its chat is off."))}
        onToast={setToast}
      />
    </div>
  );
}
