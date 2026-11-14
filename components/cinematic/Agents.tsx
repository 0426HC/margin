"use client";

import { useRouter } from "next/navigation";
import { AGENTS, demoResults, dismissAway, setAgentMode, useAgents, type AgentId } from "./agentState";
import { arrival } from "@/lib/layout/panes";
import "./agents.css";

const FEET = (
  <>
    <ellipse cx="14" cy="42" rx="3.6" ry="1.8" className="ag-foot ag-foot-l" />
    <ellipse cx="26" cy="42" rx="3.6" ry="1.8" className="ag-foot ag-foot-r" />
  </>
);

function Eyes({ y, spread = 5.5 }: { y: number; spread?: number }) {
  return (
    <g className="ag-eyes">
      <circle cx={20 - spread} cy={y} r="1.9" />
      <circle cx={20 + spread} cy={y} r="1.9" />
    </g>
  );
}

export function Body({ id }: { id: AgentId }) {
  switch (id) {
    case "explainer": // an ink drop
      return (
        <>
          {FEET}
          <path className="ag-body" d="M20 3C20 3 7 18 7 29a13 13 0 0 0 26 0C33 18 20 3 20 3Z" />
          <path className="ag-shine" d="M13.5 27c.2-3.2 1.7-6 3.4-8.3" />
          <Eyes y={30} />
        </>
      );
    case "quizzer": // a bookmark ribbon
      return (
        <>
          {FEET}
          <path className="ag-body" d="M9 5h22a2 2 0 0 1 2 2v34l-13-7-13 7V7a2 2 0 0 1 2-2Z" />
          <Eyes y={18} spread={5} />
          <path className="ag-mouth" d="M17.5 24.5q2.5 2 5 0" />
        </>
      );
    case "examiner": // a rubber stamp
      return (
        <>
          {FEET}
          <rect className="ag-body" x="14" y="4" width="12" height="15" rx="5" />
          <rect className="ag-body" x="6" y="17" width="28" height="23" rx="6" />
          <path className="ag-shine" d="M9.5 34h21" />
          <Eyes y={26} spread={6} />
        </>
      );
    case "connector": // a capsule with a loop of thread
      return (
        <>
          {FEET}
          <path className="ag-thread" d="M29 11c9-1 9 11 0 11" />
          <rect className="ag-body" x="10" y="4" width="20" height="37" rx="10" />
          <Eyes y={18} spread={4.6} />
        </>
      );
    case "librarian": // a little book with round glasses
      return (
        <>
          {FEET}
          <rect className="ag-body" x="6" y="8" width="28" height="33" rx="4" />
          <path className="ag-shine" d="M11 8v33M31 12v25" />
          <circle className="ag-glass" cx="14.5" cy="23" r="4.3" />
          <circle className="ag-glass" cx="25.5" cy="23" r="4.3" />
          <path className="ag-glass" d="M18.8 23h2.4" />
          <g className="ag-eyes">
            <circle cx="14.5" cy="23" r="1.6" />
            <circle cx="25.5" cy="23" r="1.6" />
          </g>
        </>
      );
  }
}

export type AwayItem = { id: string; agent: AgentId; text: string; onOpen: () => void };

/** Small, dismissible, and only there when something finished. Pass `items` to show real work; without them it shows the design lab's demo. */
export function WhileAway({ items, onDismiss }: { items?: AwayItem[]; onDismiss?: () => void }) {
  const { mode, dismissed } = useAgents();
  const router = useRouter();
  if (mode !== "done" || dismissed) return null;
  return (
    <aside className="wa" aria-label="While you were away">
      <div className="wa-head">
        <h2>While you were away</h2>
        <button type="button" className="wa-x" onClick={() => (dismissAway(), onDismiss?.())} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ul>
        {(items ?? demoResults.map((r) => ({ id: r.id, agent: r.agent, text: r.text, onOpen: () => {
          arrival.sectionId = r.sectionId;
          router.push(`/design-lab?section=${r.sectionId}`);
        } }))).map((r) => {
          const a = AGENTS.find((x) => x.id === r.agent)!;
          return (
            <li key={r.id}>
              <button type="button" onClick={r.onOpen}>
                <i style={{ background: a.color }} aria-hidden="true" />
                <span>
                  <b>{a.name}</b> {r.text.charAt(0).toLowerCase() + r.text.slice(1)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** Development only (`npm run dev`): flips the demo state so each of the three can be seen. Renders nothing in a production build, in tests, or anywhere else. */
export function DevToggle() {
  const { mode } = useAgents();
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <div className="dev" role="group" aria-label="Dev: agent state">
      <span>Dev, agents</span>
      {(["idle", "busy", "done"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => setAgentMode(m)}>
          {m}
        </button>
      ))}
    </div>
  );
}
