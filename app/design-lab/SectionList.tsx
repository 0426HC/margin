"use client";

import { useState } from "react";
import { MasteryMark } from "./MasteryMark";
import type { UnitMeta } from "./data";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
      <path d="M4.2 2.4 7.8 6 4.2 9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionList({
  units,
  activeId,
  onSelect,
}: {
  units: UnitMeta[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <nav className="sections" aria-label="Sections">
      {units.map((u) => {
        const open = !closed.has(u.id);
        const solid = u.sections.filter((s) => s.status === "solid").length;
        return (
          <div className="unit" key={u.id}>
            <button
              type="button"
              className="unit-head"
              aria-expanded={open}
              aria-controls={`unit-${u.id}`}
              onClick={() => toggle(u.id)}
            >
              <Chevron open={open} />
              <span className="unit-title">{u.title}</span>
              <span className="unit-count" title={`${solid} of ${u.sections.length} solid`}>
                {solid}/{u.sections.length}
              </span>
            </button>
            {open && (
              <ul id={`unit-${u.id}`} className="unit-list">
                {u.sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="sec"
                      aria-current={s.id === activeId ? "true" : undefined}
                      onClick={() => onSelect(s.id)}
                    >
                      <MasteryMark status={s.status} />
                      <span className="sec-title">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
