// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeCodeEngine, buildArgs, toCliSchema } from "@/lib/ai/claude-code-engine";
import { modelFor } from "@/lib/ai/config";
import { BadStructuredOutput, ClaudeNotInstalled, ClaudeNotLoggedIn, EngineAborted, UsageLimitReached, classifyFailure } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { acquire, setConcurrency, stats } from "@/lib/ai/queue";
import { StreamParser, parseLine } from "@/lib/ai/stream-parse";

const FX = path.join(__dirname, "../fixtures/claude");
const fixture = (n: string) => readFileSync(path.join(FX, n), "utf8");

describe("stream-parse", () => {
  it("yields text deltas and the final result from a real recorded stream", () => {
    const events = new StreamParser().push(fixture("stream-text.jsonl"));
    expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("One\nTwo\nThree");
    const result: any = events.find((e) => e.type === "result");
    expect(result.text).toBe("One\nTwo\nThree");
    expect(result.isError).toBe(false);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("returns structured_output from a --json-schema run", () => {
    const result: any = new StreamParser().push(fixture("stream-json.jsonl")).find((e) => e.type === "result");
    expect(result.structured).toEqual({ name: expect.any(String), age: expect.any(Number) });
  });

  it("handles lines split across chunks, and skips malformed lines without throwing", () => {
    const p = new StreamParser();
    const line = fixture("stream-text.jsonl").split("\n").find((l) => l.includes("text_delta"))!;
    expect(p.push(line.slice(0, 40))).toEqual([]);
    expect(p.push(line.slice(40) + "\n{not json\n\n")).toEqual([{ type: "text", delta: expect.any(String) }]);
    expect(parseLine("{broken")).toEqual([]);
  });

  it("flags error results", () => {
    const [r]: any = parseLine(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }));
    expect(r.isError).toBe(true);
  });
});

describe("errors", () => {
  it.each([
    [{ spawnError: { code: "ENOENT" } as NodeJS.ErrnoException }, ClaudeNotInstalled],
    [{ text: "Not logged in · Please run /login" }, ClaudeNotLoggedIn],
    [{ stderr: "Claude AI usage limit reached|1760000000" }, UsageLimitReached],
  ])("classifies %j", (input, cls) => {
    expect(classifyFailure(input)).toBeInstanceOf(cls);
  });
  it("does not mislabel an unknown failure", () => {
    const e = classifyFailure({ stderr: "segfault", exitCode: 139 });
    expect(e.code).toBe("EngineFailed");
    expect(e.message).toContain("segfault");
  });
});

describe("queue", () => {
  beforeEach(() => setConcurrency(2));

  it("never runs more than 2 at once", async () => {
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const release = await acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
    expect(stats()).toEqual({ running: 0, waiting: 0 });
  });

  it("aborting a waiting job frees its place in line", async () => {
    const a = await acquire();
    const b = await acquire();
    const ctl = new AbortController();
    const waiting = acquire(ctl.signal);
    expect(stats().waiting).toBe(1);
    ctl.abort();
    await expect(waiting).rejects.toBeInstanceOf(EngineAborted);
    expect(stats().waiting).toBe(0);
    a();
    b();
    expect(stats().running).toBe(0);
  });
});

describe("buildArgs and model config", () => {
  it("passes the flags from CLAUDE.md, the prompt is not an argument", () => {
    const args = buildArgs({ system: "SYS", prompt: "LONG PROMPT" });
    expect(args).toEqual(expect.arrayContaining(["-p", "--verbose", "--include-partial-messages", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]));
    expect(args).not.toContain("LONG PROMPT");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2)).toEqual(["--max-turns", "1"]);
    expect(args).not.toContain("--effort");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("adds --effort only when set, and --json-schema when given", () => {
    const args = buildArgs({ system: "s", prompt: "p", model: "claude-opus-5-5", effort: "medium" }, { type: "object" });
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4)).toEqual(["--model", "claude-opus-5-5", "--effort", "medium"]);
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual({ type: "object" });
    expect(args[args.indexOf("--max-turns") + 1]).toBe("3"); // structured output needs more than one turn
  });

  it("--json-schema gets a draft-07 schema with no $schema marker, for every schema Margin sends", async () => {
    const { explainedLayerSchema, layerBreakdownSchema, partSplitSchema, pickSourceSchema, reviewSchema } = await import("@/lib/ai/schemas");
    for (const schema of [explainedLayerSchema, layerBreakdownSchema, partSplitSchema, pickSourceSchema, reviewSchema]) {
      const out = toCliSchema(schema) as Record<string, unknown>;
      expect(out.$schema).toBeUndefined();
      expect(out.type).toBe("object");
    }
  });

  it("defaults: reviews, Explained and Source use Opus 5.5 at medium; the structure proposal and Let's talk! use sonnet", () => {
    expect(modelFor("review", {})).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("explain", {})).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("structure", {})).toEqual({ model: "sonnet" });
    expect(modelFor("talk", {})).toEqual({ model: "sonnet" });
  });

  it("env overrides model and effort; junk effort falls back; 'default' drops it", () => {
    expect(modelFor("review", { MARGIN_MODEL_REVIEW: "sonnet", MARGIN_EFFORT_REVIEW: "high" })).toEqual({ model: "sonnet", effort: "high" });
    expect(modelFor("review", { MARGIN_EFFORT_REVIEW: "banana" })).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("review", { MARGIN_EFFORT_REVIEW: "default" })).toEqual({ model: "claude-opus-5-5" });
    expect(modelFor("structure", { MARGIN_EFFORT_STRUCTURE: "low" })).toEqual({ model: "sonnet", effort: "low" });
    expect(modelFor("explain", { MARGIN_MODEL_EXPLAIN: "sonnet", MARGIN_EFFORT_EXPLAIN: "none" })).toEqual({ model: "sonnet" });
  });
});

// A fake `claude` (a node script) that records how it was called and behaves as told by FAKE_MODE.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs");
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin, files: fs.readdirSync(process.cwd()) }) + "\\n");
  const mode = process.env.FAKE_MODE || "";
  if (mode.startsWith("fixture:")) { process.stdout.write(fs.readFileSync(mode.slice(8))); return; }
  if (mode.startsWith("error-result:")) {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: mode.slice(13) }) + "\\n");
    process.exit(1);
  }
  if (mode === "hang") { fs.writeFileSync(process.env.FAKE_PID, String(process.pid)); setInterval(() => {}, 1000); }
});
`;

describe("ClaudeCodeEngine with a fake claude on PATH", () => {
  let dir: string;
  let record: string;
  const calls = () => readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const env = (mode: string) => Object.assign(process.env, { FAKE_MODE: mode });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "margin-engine-"));
    record = path.join(dir, "record.jsonl");
    writeFileSync(record, "");
    const bin = path.join(dir, "claude");
    writeFileSync(bin, FAKE_CLAUDE);
    chmodSync(bin, 0o755);
    Object.assign(process.env, { MARGIN_CLAUDE_BIN: bin, MARGIN_DATA_DIR: path.join(dir, "data"), FAKE_RECORD: record, FAKE_PID: path.join(dir, "pid") });
    setConcurrency(2);
  });
  afterEach(() => {
    for (const k of ["MARGIN_CLAUDE_BIN", "MARGIN_DATA_DIR", "FAKE_RECORD", "FAKE_PID", "FAKE_MODE"]) delete process.env[k];
  });

  it("streams text, sends the prompt on stdin, runs in an empty cwd with the right model and effort", async () => {
    env(`fixture:${path.join(FX, "stream-text.jsonl")}`);
    const chunks: string[] = [];
    let usage;
    for await (const c of new ClaudeCodeEngine().stream({ system: "SYS", prompt: "the prompt", model: "claude-opus-5-5", effort: "medium" })) {
      if (c.type === "text") chunks.push(c.delta);
      else usage = c.usage;
    }
    expect(chunks.join("")).toBe("One\nTwo\nThree");
    expect(usage).toBeDefined();
    const [call] = calls();
    expect(call.stdin).toBe("the prompt");
    expect(call.argv).not.toContain("the prompt");
    expect(call.argv.slice(call.argv.indexOf("--model"), call.argv.indexOf("--model") + 4)).toEqual(["--model", "claude-opus-5-5", "--effort", "medium"]);
    // Isolation: the cwd is the empty engine dir, so no repo CLAUDE.md can be read from it.
    expect(call.cwd.endsWith("engine-cwd")).toBe(true);
    expect(call.files).toEqual([]);
    expect(existsSync(path.join(call.cwd, "CLAUDE.md"))).toBe(false);
  });

  it("complete() returns the final text", async () => {
    env(`fixture:${path.join(FX, "stream-text.jsonl")}`);
    expect(await new ClaudeCodeEngine().complete({ system: "s", prompt: "p" })).toBe("One\nTwo\nThree");
  });

  it("json() returns validated structured output, and sends the JSON schema", async () => {
    env(`fixture:${path.join(FX, "stream-json.jsonl")}`);
    const out = await new ClaudeCodeEngine().json({ system: "s", prompt: "p" }, z.object({ name: z.string(), age: z.number() }));
    expect(out.name.length).toBeGreaterThan(0);
    const argv = calls()[0].argv;
    expect(JSON.parse(argv[argv.indexOf("--json-schema") + 1]).required).toEqual(["name", "age"]);
  });

  it("json() retries once on a bad shape, then throws BadStructuredOutput", async () => {
    env(`fixture:${path.join(FX, "stream-json.jsonl")}`);
    await expect(new ClaudeCodeEngine().json({ system: "s", prompt: "p" }, z.object({ title: z.string() }))).rejects.toBeInstanceOf(BadStructuredOutput);
    const c = calls();
    expect(c).toHaveLength(2);
    expect(c[1].stdin).toContain("rejected");
  });

  it("maps a missing binary to ClaudeNotInstalled", async () => {
    process.env.MARGIN_CLAUDE_BIN = path.join(dir, "does-not-exist");
    await expect(new ClaudeCodeEngine().complete({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(ClaudeNotInstalled);
  });

  it("maps 'Not logged in' and a usage-limit message to typed errors", async () => {
    env("error-result:Not logged in · Please run /login");
    await expect(new ClaudeCodeEngine().complete({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(ClaudeNotLoggedIn);
    env("error-result:Claude AI usage limit reached");
    await expect(new ClaudeCodeEngine().complete({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(UsageLimitReached);
  });

  it("aborting kills the child process and frees the slot", async () => {
    env("hang");
    const ctl = new AbortController();
    const done = new ClaudeCodeEngine().complete({ system: "s", prompt: "p" }, ctl.signal).catch((e) => e);
    const pidFile = path.join(dir, "pid");
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 30));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    ctl.abort();
    expect(await done).toBeInstanceOf(EngineAborted);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(stats().running).toBe(0);
  });
});

describe("FakeEngine", () => {
  it("records calls, streams words, validates canned JSON", async () => {
    const fake = new FakeEngine({ text: "hello there", json: { n: 1 } });
    const words: string[] = [];
    for await (const c of fake.stream({ system: "s", prompt: "p" })) if (c.type === "text") words.push(c.delta);
    expect(words.join("")).toBe("hello there");
    expect(await fake.json({ system: "s", prompt: "p" }, z.object({ n: z.number() }))).toEqual({ n: 1 });
    expect(fake.calls).toHaveLength(2);
    await expect(fake.json({ system: "s", prompt: "p" }, z.object({ n: z.string() }))).rejects.toThrow();
  });
  it("stops streaming when aborted", async () => {
    const ctl = new AbortController();
    const it = new FakeEngine({ text: "a b c d", delayMs: 20 }).stream({ system: "s", prompt: "p" }, ctl.signal);
    setTimeout(() => ctl.abort(), 30);
    await expect((async () => { for await (const _ of it); })()).rejects.toBeInstanceOf(EngineAborted);
  });
});
