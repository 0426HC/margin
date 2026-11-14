"use client";

import Link from "next/link";
import { useState } from "react";
import { LayerMark } from "@/components/ui/LayerMark";
import type { StructureModel } from "@/lib/layers/types";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }}>
      <path d="M4.2 2.4 7.8 6 4.2 9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Layers under Part A and Part B, each Part ending with its synthesis. Each Part collapses and shows how many of its layers are done. Nothing is locked. */
export function LayerList({ model, activeId }: { model: StructureModel; activeId: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <nav className="m-sections surface-desk" aria-label="Layers">
      {model.parts.map((p) => {
        const open = !closed.has(p.id);
        return (
          <div className="m-unit" key={p.id}>
            <button type="button" className="m-unit-head" aria-expanded={open} aria-controls={`part-${p.id}`} onClick={() => toggle(p.id)}>
              <Chevron open={open} />
              <span className="m-lunit-title">{p.title}</span>
              <span className="m-unit-count" title={`${p.progress.saved} of ${p.progress.total} layers saved`}>
                {p.progress.saved}/{p.progress.total}
              </span>
            </button>
            {open && (
              <ul id={`part-${p.id}`} className="m-unit-list">
                {p.layers.map((l) => (
                  <li key={l.id}>
                    <Link href={`/p/${model.project.id}/l/${l.id}`} className="m-sec" aria-current={l.id === activeId ? "true" : undefined} scroll={false}>
                      <LayerMark state={l.state} />
                      <span className="m-sec-title">{l.title}</span>
                    </Link>
                  </li>
                ))}
                <li className="m-synth-item">
                  <Link href={`/p/${model.project.id}/part/${p.key}/synthesis`} className="m-sec m-sec-synth" aria-current={activeId === `synthesis-${p.id}` ? "true" : undefined} scroll={false}>
                    <LayerMark state={p.synthesis} />
                    <span className="m-sec-title">{p.title} synthesis</span>
                  </Link>
                </li>
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
