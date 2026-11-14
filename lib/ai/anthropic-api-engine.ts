import type { z } from "zod";
import type { Engine, StreamChunk } from "./engine";
import { EngineNotConfigured } from "./errors";

const notConfigured = (): never => {
  throw new EngineNotConfigured("The Anthropic API engine");
};

/** A stub, so an API key can be swapped in later through env config. It has no logic on purpose. */
export class AnthropicApiEngine implements Engine {
  async complete(): Promise<string> {
    return notConfigured();
  }
   
  async *stream(): AsyncIterable<StreamChunk> {
    notConfigured();
  }
  async json<T>(_req?: unknown, _schema?: z.ZodType<T>): Promise<T> {
    return notConfigured();
  }
}
