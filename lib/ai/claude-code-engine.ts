import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "../db/paths";
import type { AiRequest, Engine, StreamChunk } from "./engine";
import { BadStructuredOutput, EngineAborted, classifyFailure } from "./errors";
import { acquire } from "./queue";
import { StreamParser, type ParsedEvent, type Usage } from "./stream-parse";

export const DEFAULT_MODEL = "sonnet";

/** An empty directory, so no repo CLAUDE.md or project settings leak into tutoring calls. */
export function engineCwd(): string {
  const dir = path.join(dataDir(), "engine-cwd");
  mkdirSync(dir, { recursive: true });
  return dir;
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
    "--setting-sources", "project",
    "--disable-slash-commands",
    ...(jsonSchema ? ["--json-schema", JSON.stringify(jsonSchema)] : []),
  ];
}

/** The CLI validates `--json-schema` with a draft-07 validator, so no `$schema` marker and nothing newer than draft-07. */
export function toCliSchema(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

type Result = Extract<ParsedEvent, { type: "result" }>;

/** Spawn the official `claude` binary and yield its events. Never reads credentials. Kills the child on abort or early exit. */
async function* run(req: AiRequest, signal?: AbortSignal, jsonSchema?: object): AsyncGenerator<ParsedEvent> {
  const release = await acquire(signal);
  const child = spawn(process.env.MARGIN_CLAUDE_BIN || "claude", buildArgs(req, jsonSchema), { cwd: engineCwd(), stdio: ["pipe", "pipe", "pipe"] });
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
  child.stdin.end(req.prompt);

  const parser = new StreamParser();
  let result: Result | undefined;
  let tail = "";
  try {
    for await (const chunk of child.stdout) {
      const textChunk = chunk.toString("utf8");
      tail = (tail + textChunk).slice(-600);
      for (const ev of parser.push(textChunk)) {
        if (ev.type === "result") result = ev;
        else yield ev;
      }
    }
    for (const ev of parser.flush()) if (ev.type === "result") result = ev;
    const code = await closed;
    if (signal?.aborted) throw new EngineAborted();
    if (spawnError) throw classifyFailure({ spawnError });
    if (result?.isError) throw classifyFailure({ text: result.text || `result: ${result.subtype ?? "error"}`, stderr });
    if (!result) throw classifyFailure({ stderr: `${stderr}${signalName ? ` (stopped by ${signalName})` : ""} Last output: ${tail}`, exitCode: code });
    yield result;
  } finally {
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
      else usage = ev.usage;
    }
    yield { type: "done", usage };
  }

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
      const parsed = schema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      detail = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    }
    throw new BadStructuredOutput(detail);
  }
}
