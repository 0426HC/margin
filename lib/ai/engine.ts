import type { z } from "zod";
import type { Usage } from "./stream-parse";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiRequest {
  system: string;
  /** Sent on stdin, never as an argument: prompts can be long. */
  prompt: string;
  model?: string;
  effort?: Effort;
  /** Which job this is ("explain", "review", ...), for the server log. */
  task?: string;
  /**
   * "now": something the student is waiting for (a layer they opened, a chat answer). "background": work nobody is watching (the brain,
   * layers written ahead). Calls for "now" always go first, and background calls never take the last free places (`lib/ai/queue.ts`).
   */
  priority?: Priority | (() => Priority);
  /** Called whenever Claude sends anything (thinking or text), so a caller can tell a slow answer from a stuck one. */
  onActivity?: () => void;
}

export type Priority = "now" | "background";

export type StreamChunk = { type: "text"; delta: string } | { type: "done"; usage: Usage };

/** The one door to the AI. Components never see a prompt string or a process. */
export interface Engine {
  complete(req: AiRequest, signal?: AbortSignal): Promise<string>;
  stream(req: AiRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>;
  /** Structured output, validated with Zod even though the CLI also checks `--json-schema`. Retried once on a bad shape. */
  json<T>(req: AiRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>;
}
