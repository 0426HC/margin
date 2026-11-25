import type { z } from "zod";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { EngineAborted, EngineError } from "./errors";

type Responder<T> = T | ((req: AiRequest) => T);
export interface FakeOptions {
  text?: Responder<string>;
  json?: Responder<unknown>;
  /** Pause between streamed words, so streaming UI can be exercised. */
  delayMs?: number;
  /** A different pause for some calls (a slow layer for the browser tests), else `delayMs`. */
  delayFor?: (req: AiRequest) => number | undefined;
  /** Calls that never answer (until cancelled), so time limits can be tested. */
  hang?: (req: AiRequest) => boolean;
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
    if (this.opts.hang?.(req)) await wait(2 ** 31 - 1, signal);
    // in at most about 25 steps, so a long answer streams in visible steps without taking long
    const all = pick(this.opts.text ?? "This is a canned reply.", req).split(/(?<=\s)/);
    const size = Math.max(1, Math.ceil(all.length / 25));
    const words = Array.from({ length: Math.ceil(all.length / size) }, (_, i) => all.slice(i * size, i * size + size).join(""));
    const delay = this.opts.delayFor?.(req) ?? this.opts.delayMs;
    for (const w of words) {
      // with no delay the words come at once (a timer per word would take seconds for a long answer)
      if (delay) await wait(delay, signal);
      else if (signal?.aborted) throw new EngineAborted();
      req.onActivity?.();
      yield { type: "text", delta: w };
    }
    yield { type: "done", usage: { inputTokens: 0, outputTokens: all.length } };
  }

  async json<T>(req: AiRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    this.calls.push(req);
    if (this.opts.hang?.(req)) await wait(2 ** 31 - 1, signal);
    await wait(this.opts.delayMs ?? 0, signal);
    if (this.opts.json === undefined) throw new EngineError("FakeEngineEmpty", "FakeEngine has no canned JSON for this call.");
    return schema.parse(pick(this.opts.json, req));
  }
}
