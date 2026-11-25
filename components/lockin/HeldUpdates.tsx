"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { updateLines, waitingLabel, type UpdateTask } from "@/lib/lockin/held";

/** The project a page belongs to, read from its address (/p/[id]/...). */
export function projectOf(path: string | null): string | null {
  return path?.match(/^\/p\/([^/]+)/)?.[1] ?? null;
}

/**
 * While locked in, the agents' updates ("While you were away", "Ready for you") are held: none is shown, and this quiet dashed pill
 * counts them. Switching lock in off lets them show as usual (the overview's corner). Hidden when nothing is waiting.
 */
export function HeldUpdates() {
  const projectId = projectOf(usePathname());
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const d = (await fetch(`/api/projects/${projectId}/agent-tasks`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { running: UpdateTask[]; unseen: UpdateTask[] } | null;
      if (stop) return;
      if (d) setCount(updateLines(d.unseen).length);
      timer = setTimeout(poll, d?.running.length ? 1500 : 5000);
    };
    void poll();
    const wake = () => void poll();
    window.addEventListener("margin:agents", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("margin:agents", wake);
    };
  }, [projectId]);

  const label = projectId ? waitingLabel(count) : null;
  if (!label) return null;
  return (
    <span className="lk-held" role="status" title="The agents finished something. It shows when you switch Lock in off.">
      {label}
    </span>
  );
}
