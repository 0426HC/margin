import type { z } from "zod";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { EngineAborted, EngineError } from "./errors";

type Responder<T> = T | ((req: AiRequest) => T);
export interface FakeOptions {
  text?: Responder<string>;
  json?: Responder<unknown>;
  /** Pause between streamed words, so streaming UI can be exercised. */
  delayMs?: number;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new EngineAborted());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new EngineAborted())), { once: true });
  });
const pick = <T>(r: Responder<T>, req: AiRequest): T => (typeof r === "function" ? (r as (q: AiRequest) => T)(req) : r);

/** Canned, schema-valid output with realistic delays. Selected with MARGIN_ENGINE=fake. Records every call. */
export class FakeEngine implements Engine {
  readonly calls: AiRequest[] = [];
  constructor(private opts: FakeOptions = {}) {}

  async complete(req: AiRequest, signal?: AbortSignal): Promise<string> {
    this.calls.push(req);
    await wait(this.opts.delayMs ?? 0, signal);
    return pick(this.opts.text ?? "This is a canned reply.", req);
  }

  async *stream(req: AiRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    this.calls.push(req);
    const words = pick(this.opts.text ?? "This is a canned reply.", req).split(/(?<=\s)/);
    for (const w of words) {
      await wait(this.opts.delayMs ?? 0, signal);
      yield { type: "text", delta: w };
    }
    yield { type: "done", usage: { inputTokens: 0, outputTokens: words.length } };
  }

  async json<T>(req: AiRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    this.calls.push(req);
    await wait(this.opts.delayMs ?? 0, signal);
    if (this.opts.json === undefined) throw new EngineError("FakeEngineEmpty", "FakeEngine has no canned JSON for this call.");
    return schema.parse(pick(this.opts.json, req));
  }
}
