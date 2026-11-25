"use client";

import Link from "next/link";
import { useState } from "react";
import { LayerMark } from "@/components/ui/LayerMark";
import type { LayerState } from "@/lib/layers/progress";
import type { StructureLayer, StructureModel, StructureWeek } from "@/lib/layers/types";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
      <path d="M4.2 2.4 7.8 6 4.2 9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The week synthesis's own mark: a diamond, hollow until something is saved, so it never reads as one more layer. */
export function SynthesisMark({ state }: { state: LayerState }) {
  return (
    <svg className="m-diamond" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" data-state={state}>
      <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill={state === "saved" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function LayerRow({ projectId, layer, activeId }: { projectId: string; layer: StructureLayer; activeId: string }) {
  return (
    <Link href={`/p/${projectId}/l/${layer.id}`} className="m-sec" aria-current={layer.id === activeId ? "true" : undefined} scroll={false}>
      <LayerMark state={layer.state} />
      <span className="m-sec-title">{layer.title}</span>
      {layer.newMaterial && (
        <span className="m-sec-fresh" title="New material since you saved" aria-label="New material since you saved">
          New
        </span>
      )}
    </Link>
  );
}

function SynthesisRow({ projectId, week, activeId }: { projectId: string; week: StructureWeek; activeId: string }) {
  return (
    <Link href={`/p/${projectId}/week/${week.week}/synthesis`} className="m-sec m-sec-synth" aria-current={activeId === `synthesis-${week.id}` ? "true" : undefined} scroll={false}>
      <SynthesisMark state={week.synthesis} />
      <span className="m-sec-title">
        Week synthesis<span className="sr-only"> for week {week.week}</span>
      </span>
      <span className="m-sec-wk">{week.synthesis === "saved" ? "saved" : "optional"}</span>
      {week.synthesis !== "saved" && <span className="sr-only">, not saved</span>}
    </Link>
  );
}

/**
 * The layers sidebar: the course by week, each week collapsible with its count, its layers in idea order and its optional synthesis last.
 * Weeks whose material hasn't been added yet are listed too, quietly. The week being studied starts open. Nothing is locked.
 */
export function LayerList({ model, activeId }: { model: StructureModel; activeId: string }) {
  const projectId = model.project.id;
  const activeWeek = model.weeks.find((w) => w.layers.some((l) => l.id === activeId) || activeId === `synthesis-${w.id}`)?.week ?? model.currentWeek;
  const [open, setOpen] = useState<Set<number>>(() => new Set([activeWeek]));
  const toggle = (week: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(week)) n.delete(week);
      else n.add(week);
      return n;
    });
  return (
    <nav className="m-sections surface-desk" aria-label="Layers">
      {model.weeks.map((w) => {
        if (!w.layers.length)
          return (
            <div className="m-unit m-wk-blank" key={w.week}>
              <p className="m-unit-head" aria-disabled="true">
                <span className="m-lunit-title">{w.label}</span>
              </p>
              <p className="m-wk-empty">Material not added yet</p>
            </div>
          );
        const isOpen = open.has(w.week);
        return (
          <div className="m-unit" key={w.week}>
            <button type="button" className="m-unit-head" aria-expanded={isOpen} aria-controls={`week-${w.week}`} onClick={() => toggle(w.week)}>
              <Chevron open={isOpen} />
              <span className="m-lunit-title">{w.label}</span>
              <span className="m-unit-count" title={`${w.progress.saved} of ${w.progress.total} layers saved`}>
                {w.progress.saved}/{w.progress.total}
              </span>
            </button>
            {isOpen && (
              <ul id={`week-${w.week}`} className="m-unit-list">
                {w.layers.map((l) => (
                  <li key={l.id}>
                    <LayerRow projectId={projectId} layer={l} activeId={activeId} />
                  </li>
                ))}
                <li className="m-synth-item">
                  <SynthesisRow projectId={projectId} week={w} activeId={activeId} />
                </li>
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
