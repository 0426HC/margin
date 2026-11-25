import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { BadStructuredOutput, EngineAborted, EngineError, EngineTimeout, UsageLimitReached, classifyFailure } from "./errors";
import { acquire } from "./queue";
import { StreamParser, type ParsedEvent, type Usage } from "./stream-parse";

export const DEFAULT_MODEL = "sonnet";

/**
 * An empty temporary folder outside the project, made once per server. Claude Code reads CLAUDE.md, settings and skills from the folder it
 * runs in and from every folder above it, so a folder inside the repo (the Mac app keeps its data in margin/.data) sent Margin's own
 * CLAUDE.md and skills with every call: about 11,800 extra tokens each time.
 */
export function engineCwd(): string {
  const g = globalThis as unknown as { __margin_engine_cwd__?: string };
  if (!g.__margin_engine_cwd__ || !existsSync(g.__margin_engine_cwd__)) g.__margin_engine_cwd__ = mkdtempSync(path.join(realpathSync(os.tmpdir()), "margin-claude-"));
  return g.__margin_engine_cwd__;
}

/** The argv for one call. Pure, so tests can assert exactly what gets spawned. */
export function buildArgs(req: AiRequest, jsonSchema?: object): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", req.model ?? DEFAULT_MODEL,
    ...(req.effort ? ["--effort", req.effort] : []),
    "--system-prompt", req.system,
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    // Plain text is one turn. Structured output needs two (the CLI answers through a hidden tool), and a third if it has to fix a shape error itself.
    "--max-turns", jsonSchema ? "3" : "1",
    // Only Margin's prompt goes in: no CLAUDE.md, auto-memory, skills, plugins, hooks, MCP servers or custom agents (--safe-mode), no user
    // settings (only the empty folder's own project settings), no slash commands and no Chrome.
    "--safe-mode",
    "--setting-sources", "project",
    "--disable-slash-commands",
    "--no-chrome",
    ...(jsonSchema ? ["--json-schema", JSON.stringify(jsonSchema)] : []),
  ];
}

/** The CLI validates `--json-schema` with a draft-07 validator, so no `$schema` marker and nothing newer than draft-07. */
export function toCliSchema(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

type Result = Extract<ParsedEvent, { type: "result" }>;

const seconds = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
/** How long Claude may go without sending anything (thinking and writing both stream) before Margin gives up. MARGIN_AI_IDLE_S. */
export const idleLimitMs = () => seconds("MARGIN_AI_IDLE_S", 180) * 1000;
/** The most one call may take, however busy it looks. MARGIN_AI_MAX_S. */
export const callLimitMs = () => seconds("MARGIN_AI_MAX_S", 600) * 1000;

/**
 * One line per call in the server log (the Mac app keeps it in .mac-app/logs/server.log): which task, model and effort, how much text was
 * sent, how long it took and how it ended. Never the prompt itself.
 */
export function logCall(req: AiRequest, ms: number, outcome: string, usage?: Usage) {
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const tokens = usage ? ` · tokens in ${k(usage.inputTokens)} out ${k(usage.outputTokens)}` : "";
  console.log(`[margin ai] ${req.task ?? "call"} · ${req.model ?? DEFAULT_MODEL}${req.effort ? ` · ${req.effort}` : ""} · sent ${k(req.system.length + req.prompt.length)} chars · ${(ms / 1000).toFixed(1)}s · ${outcome}${tokens}`);
}

/** Spawn the official `claude` binary and yield its events. Never reads credentials. Kills the child on abort, timeout or early exit. */
async function* run(req: AiRequest, signal?: AbortSignal, jsonSchema?: object): AsyncGenerator<ParsedEvent> {
  const release = await acquire(signal, req.priority ?? "now");
  const started = Date.now();
  const child = spawn(/* turbopackIgnore: true */ process.env.MARGIN_CLAUDE_BIN || "claude", buildArgs(req, jsonSchema), { cwd: engineCwd(), stdio: ["pipe", "pipe", "pipe"] });
  let spawnError: NodeJS.ErrnoException | undefined;
  let stderr = "";
  let signalName: NodeJS.Signals | null = null;
  const closed = new Promise<number | null>((resolve) => {
    child.on("error", (e) => {
      spawnError = e;
      resolve(null);
    });
    child.on("close", (code, sig) => {
      signalName = sig;
      resolve(code);
    });
  });
  child.stderr.on("data", (d) => (stderr += d));
  child.stdin.on("error", () => {});
  const onAbort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });
  // A run that goes quiet, or runs past the limit, is stopped rather than waited on forever.
  let timedOut: "idle" | "total" | null = null;
  const stop = (why: "idle" | "total") => {
    timedOut ??= why;
    child.kill("SIGKILL");
  };
  let idle = setTimeout(() => stop("idle"), idleLimitMs());
  const total = setTimeout(() => stop("total"), callLimitMs());
  child.stdin.end(req.prompt);

  const parser = new StreamParser();
  let result: Result | undefined;
  let rejected: Extract<ParsedEvent, { type: "limit" }> | undefined;
  let tail = "";
  let outcome = "failed";
  try {
    for await (const chunk of child.stdout) {
      req.onActivity?.();
      clearTimeout(idle);
      idle = setTimeout(() => stop("idle"), idleLimitMs());
      const textChunk = chunk.toString("utf8");
      tail = (tail + textChunk).slice(-600);
      for (const ev of parser.push(textChunk)) {
        if (ev.type === "result") result = ev;
        else if (ev.type === "limit") rejected = ev.status === "rejected" ? ev : rejected;
        else yield ev;
      }
    }
    for (const ev of parser.flush()) if (ev.type === "result") result = ev;
    const code = await closed;
    if (signal?.aborted) throw new EngineAborted();
    if (timedOut === "idle") throw new EngineTimeout(`Claude stopped answering for ${Math.round(idleLimitMs() / 60_000)} minutes, so Margin stopped waiting. Try again.`);
    if (timedOut === "total") throw new EngineTimeout(`Claude was still working after ${Math.round(callLimitMs() / 60_000)} minutes, so Margin stopped waiting. Try again.`);
    if (spawnError) throw classifyFailure({ spawnError });
    // the plan's limit, as Claude Code reports it, whatever words the error itself uses
    if (rejected && (!result || result.isError)) throw new UsageLimitReached(rejected.resetsAt);
    if (result?.isError) throw classifyFailure({ text: result.text || `result: ${result.subtype ?? "error"}`, stderr, apiStatus: result.apiStatus });
    if (!result) throw classifyFailure({ stderr: `${stderr}${signalName ? ` (stopped by ${signalName})` : ""} Last output: ${tail}`, exitCode: code });
    outcome = "ok";
    yield result;
  } catch (e) {
    outcome = e instanceof EngineError ? `failed: ${e.code}` : "failed";
    throw e;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    logCall(req, Date.now() - started, outcome, result?.usage);
    signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    release();
  }
}

async function finalResult(events: AsyncIterable<ParsedEvent>): Promise<Result> {
  let last: Result | undefined;
  for await (const ev of events) if (ev.type === "result") last = ev;
  if (!last) throw classifyFailure({});
  return last;
}

function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text.trim();
}

export class ClaudeCodeEngine implements Engine {
  async complete(req: AiRequest, signal?: AbortSignal): Promise<string> {
    return (await finalResult(run(req, signal))).text;
  }

  async *stream(req: AiRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const ev of run(req, signal)) {
      if (ev.type === "text") yield { type: "text", delta: ev.delta };
      else if (ev.type === "result") usage = ev.usage;
    }
    yield { type: "done", usage };
  }

  /** See `unescapeQuotes`. */
  async json<T>(req: AiRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const jsonSchema = toCliSchema(schema);
    let detail = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0 ? req.prompt : `${req.prompt}\n\nYour previous answer was rejected: ${detail}\nAnswer again with valid JSON that matches the schema exactly.`;
      const res = await finalResult(run({ ...req, prompt }, signal, jsonSchema));
      let candidate = res.structured;
      if (candidate === undefined) {
        try {
          candidate = JSON.parse(stripFence(res.text));
        } catch {
          detail = "It was not valid JSON.";
          continue;
        }
      }
      const parsed = schema.safeParse(unescapeQuotes(candidate));
      if (parsed.success) return parsed.data;
      detail = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    }
    throw new BadStructuredOutput(detail);
  }
}

/**
 * Claude sometimes writes a quotation inside a structured answer with its JSON escaping left in the text (\"from reflection and choice\"),
 * which would show as a backslash. A backslash before a quote never means anything in Margin's prose, so it goes from every string. Pure.
 */
export function unescapeQuotes(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\\(["“”])/g, "$1");
  if (Array.isArray(v)) return v.map(unescapeQuotes);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unescapeQuotes(x)]));
  return v;
}
