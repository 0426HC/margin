import { AgentFigure } from "@/components/cinematic/Stage";

export type DeskPhase = "idle" | "over" | "reading" | "done" | "stuck";

/** What the Librarian says in each phase. Plain, specific, one thing at a time. */
function line(phase: DeskPhase, p: { read: number; total: number; failed: number; current?: string }) {
  switch (phase) {
    case "over":
      return "Right here. I will take it from you.";
    case "reading":
      return p.current ? `Reading ${p.current}. ${p.read} of ${p.total} are on the desk.` : `${p.read} of ${p.total} are on the desk.`;
    case "done":
      return `All ${p.read} are read${p.failed ? `, and I set ${p.failed} aside` : ""}. Next I will group them into units, then propose Part A, Part B and their layers for you to approve.`;
    case "stuck":
      return "None of these would open. Check the notes on each file, or bring another folder.";
    default:
      return "Drop a course folder and I will take the files. I read each one once, here on your computer.";
  }
}

/** The Librarian at a desk: files land on the stack as they are read, so the room reacts to what is happening. */
export function LibrarianDesk({ phase, read, failed, total, current }: { phase: DeskPhase; read: number; failed: number; total: number; current?: string }) {
  const sheets = Math.min(read + failed, 14);
  return (
    <aside className="st-desk" aria-label="The Librarian">
      <div className="st-desk-scene" aria-hidden="true">
        <div className="st-desk-top" />
        <span className="st-desk-agent">
          <AgentFigure id="librarian" size={104} mood={phase === "over" ? "eager" : phase === "reading" ? "busy" : "idle"} />
        </span>
        <div className="st-stack">
          {Array.from({ length: sheets }, (_, n) => (
            <span key={n} className="st-sheetlet" data-failed={n >= read ? "" : undefined} style={{ ["--n" as string]: n, ["--dx" as string]: `${((n * 37) % 13) - 6}px`, ["--r" as string]: `${((n * 53) % 9) - 4}deg` }} />
          ))}
        </div>
      </div>
      <p className="st-slip st-desk-slip" data-tail="left">
        <span className="st-slip-who">Librarian</span>
        {line(phase, { read, failed, total, current })}
      </p>
    </aside>
  );
}
