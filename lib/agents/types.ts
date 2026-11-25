export type AgentDocBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] };

export interface AgentDocument {
  id: string;
  agent: "explainer" | "quizzer" | "examiner" | "connector" | "librarian";
  title: string;
  request: string;
  blocks: AgentDocBlock[];
  createdAt: number;
}
