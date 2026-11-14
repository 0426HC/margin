"use client";

import { useState, type ReactNode } from "react";

export type RightTab = "write" | "talk";

// Which tab was open last, kept while the reader moves between layers in this visit, so a conversation isn't left behind.
const last = { tab: "write" as RightTab };

export function useRightTab(): [RightTab, (t: RightTab) => void] {
  const [tab, set] = useState<RightTab>(() => last.tab);
  return [tab, (t) => ((last.tab = t), set(t))];
}

/**
 * The right column: the write-back for this layer or synthesis, or Let's talk!. Both stay mounted, so a half-written
 * answer and a conversation in progress survive a switch. The tabs sit on the desk above the panel.
 */
export function RightPane({ tab, onTab, writeLabel, write, talk }: { tab: RightTab; onTab: (t: RightTab) => void; writeLabel: string; write: ReactNode; talk: ReactNode }) {
  const tabs: { value: RightTab; label: string }[] = [
    { value: "write", label: writeLabel },
    { value: "talk", label: "Let’s talk!" },
  ];
  return (
    <div className="m-right">
      <div
        className="m-rtabs"
        role="tablist"
        aria-label="Right pane"
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const next = tab === "write" ? "talk" : "write";
          onTab(next);
          document.getElementById(`rtab-${next}`)?.focus();
        }}
      >
        {tabs.map((t) => (
          <button key={t.value} type="button" role="tab" id={`rtab-${t.value}`} aria-selected={tab === t.value} aria-controls={`rpanel-${t.value}`} tabIndex={tab === t.value ? 0 : -1} className="m-rtab" onClick={() => onTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="m-rbody" id="rpanel-write" role="tabpanel" aria-labelledby="rtab-write" hidden={tab !== "write"}>
        {write}
      </div>
      <div className="m-rbody" id="rpanel-talk" role="tabpanel" aria-labelledby="rtab-talk" hidden={tab !== "talk"}>
        {talk}
      </div>
    </div>
  );
}
