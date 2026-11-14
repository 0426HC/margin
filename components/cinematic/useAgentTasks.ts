"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setAgentMode, type AgentId } from "./agentState";

export interface AgentTaskView {
  id: string;
  agent: AgentId;
  kind: string;
  summary: string;
  result: string | null;
}

/**
 * Real agent work for one project, polled from the server: while a task runs the dining hall is busy, and when one finishes its
 * result waits in "While you were away" until it is dismissed. The hall's mode only changes when the server's picture changes,
 * so the dev toggle keeps working in between.
 */
export function useAgentTasks(projectId: string) {
  const [running, setRunning] = useState<AgentTaskView[]>([]);
  const [unseen, setUnseen] = useState<AgentTaskView[]>([]);
  const last = useRef("");
  const set = useRef(false);

  const poll = useCallback(async () => {
    const d = (await fetch(`/api/projects/${projectId}/agent-tasks`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { running: AgentTaskView[]; unseen: AgentTaskView[] } | null;
    if (!d) return false;
    const sig = `${d.running.map((t) => t.id).join()}|${d.unseen.map((t) => t.id).join()}`;
    setRunning(d.running);
    setUnseen(d.unseen);
    if (sig !== last.current) {
      last.current = sig;
      if (d.running.length) setAgentMode("busy");
      else if (d.unseen.length) setAgentMode("done");
      else if (set.current) setAgentMode("idle");
      set.current = set.current || d.running.length > 0 || d.unseen.length > 0;
    }
    return d.running.length > 0;
  }, [projectId]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const busy = await poll();
      if (!stop) timer = setTimeout(tick, busy ? 1500 : 5000);
    };
    void tick();
    // a task started in this tab (the Find sources button) should show at once, not at the next poll
    const wake = () => void poll();
    window.addEventListener("margin:agents", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("margin:agents", wake);
      if (set.current) setAgentMode("idle");
    };
  }, [poll]);

  const dismiss = useCallback(async () => {
    await fetch(`/api/projects/${projectId}/agent-tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    last.current = "";
    void poll();
  }, [projectId, poll]);

  return { running, unseen, dismiss };
}
