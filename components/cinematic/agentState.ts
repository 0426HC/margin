"use client";

import { useSyncExternalStore } from "react";

// Margin's five agents. Original characters: small paper-and-ink creatures, one shape and one colour each.
export type AgentId = "explainer" | "quizzer" | "examiner" | "connector" | "librarian";
export type AgentMode = "idle" | "busy" | "done";

export const AGENTS: { id: AgentId; name: string; job: string; color: string }[] = [
  { id: "explainer", name: "Explainer", job: "writes each layer's Explained tab", color: "#74bde6" },
  { id: "quizzer", name: "Quizzer", job: "explains again, more simply, when you don't get it", color: "#e38fb0" },
  { id: "examiner", name: "Examiner", job: "reviews what you write back", color: "#a98bdc" },
  { id: "connector", name: "Connector", job: "writes the so what and links the layers", color: "#7f8fe6" },
  { id: "librarian", name: "Librarian", job: "picks the Source quotes and finds the pages", color: "#edf0f6" },
];

/** Demo data: one bigger request, handed between three agents. */
export const demoTask = {
  summary: "Writing the layers of week 3",
  involved: ["librarian", "connector", "explainer"] as AgentId[],
  /** Paper notes passed between agents, as slot pairs. */
  notes: [
    ["librarian", "connector"],
    ["connector", "explainer"],
  ] as [AgentId, AgentId][],
};

type State = { mode: AgentMode; dismissed: boolean };
let state: State = { mode: "idle", dismissed: false };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => state;
const server: State = { mode: "idle", dismissed: false };

export function setAgentMode(mode: AgentMode) {
  state = { mode, dismissed: false };
  listeners.forEach((l) => l());
}
export function dismissAway() {
  state = { ...state, dismissed: true };
  listeners.forEach((l) => l());
}
export function useAgents() {
  return useSyncExternalStore(subscribe, snapshot, () => server);
}
