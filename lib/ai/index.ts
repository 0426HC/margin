import { AnthropicApiEngine } from "./anthropic-api-engine";
import { ClaudeCodeEngine } from "./claude-code-engine";
import type { Engine } from "./engine";
import { cannedEngine } from "./canned";

export type { AiRequest, Effort, Engine, StreamChunk } from "./engine";
export { modelFor } from "./config";

let cached: { name: string; engine: Engine } | undefined;

/** The engine chosen by MARGIN_ENGINE: `claude-code` (default), `anthropic-api` (stub) or `fake` (tests, offline). */
export function getEngine(): Engine {
  const name = process.env.MARGIN_ENGINE || "claude-code";
  if (cached?.name !== name) {
    cached = { name, engine: name === "fake" ? cannedEngine() : name === "anthropic-api" ? new AnthropicApiEngine() : new ClaudeCodeEngine() };
  }
  return cached.engine;
}
