import type { CSSProperties } from "react";

// Margin's five agents. Original characters: small paper-and-ink creatures, one shape and one colour each.
export type AgentId = "explainer" | "quizzer" | "examiner" | "connector" | "librarian";

export const AGENTS: { id: AgentId; name: string; job: string; shape: string; color: string }[] = [
  { id: "explainer", name: "Explainer", job: "Writes plain-English walkthroughs", shape: "Ink drop", color: "var(--agent-explainer)" },
  { id: "quizzer", name: "Quizzer", job: "Asks one question at a time", shape: "Bookmark", color: "var(--agent-quizzer)" },
  { id: "examiner", name: "Examiner", job: "Grades what you teach back", shape: "Rubber stamp", color: "var(--agent-examiner)" },
  { id: "connector", name: "Connector", job: "Links sections across the course", shape: "Thread capsule", color: "var(--agent-connector)" },
  { id: "librarian", name: "Librarian", job: "Finds the passage and the page", shape: "Book with glasses", color: "var(--agent-librarian)" },
];

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

function Body({ id }: { id: AgentId }) {
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


/** One agent, drawn from the front. The eyes blink on their own; under reduced motion they stay open. */
export function AgentCharacter({ id, size = 64, blinkDelay = 0 }: { id: AgentId; size?: number; blinkDelay?: number }) {
  const agent = AGENTS.find((a) => a.id === id)!;
  return (
    <svg
      viewBox="0 0 40 46"
      width={size * 0.87}
      height={size}
      role="img"
      aria-label={`${agent.name}: ${agent.shape.toLowerCase()}`}
      style={{ "--c": agent.color, "--blink-delay": `${blinkDelay}s`, overflow: "visible" } as CSSProperties}
    >
      <Body id={id} />
    </svg>
  );
}
