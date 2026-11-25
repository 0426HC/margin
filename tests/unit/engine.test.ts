// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeEngine, buildArgs, toCliSchema } from "@/lib/ai/claude-code-engine";
import { modelFor } from "@/lib/ai/config";
import { BadStructuredOutput, ClaudeBusy, ClaudeNotInstalled, ClaudeNotLoggedIn, EngineAborted, EngineTimeout, UsageLimitReached, classifyFailure, resetTime } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { acquire, requeue, setConcurrency, stats } from "@/lib/ai/queue";
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

  it("reads the plan's usage window, and the API's error status", () => {
    expect(parseLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1794385200 } }))).toEqual([{ type: "limit", status: "rejected", resetsAt: new Date(1794385200 * 1000) }]);
    const [r] = parseLine(JSON.stringify({ type: "result", is_error: true, api_error_status: 529, result: "x" }));
    expect(r).toMatchObject({ type: "result", isError: true, apiStatus: 529 });
  });
  it("flags error results", () => {
    const [r]: any = parseLine(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }));
    expect(r.isError).toBe(true);
  });
});

describe("errors", () => {
  it("knows the plan's limit in every wording Claude Code has used, and Anthropic being busy", () => {
    for (const text of ["Claude AI usage limit reached|1794385200", "5-hour limit reached ∙ resets 3pm", "You've hit your limit · resets 8pm (Europe/London)", "You've hit your weekly limit"])
      expect(classifyFailure({ text })).toBeInstanceOf(UsageLimitReached);
    expect(classifyFailure({ text: "Request failed", apiStatus: 429 })).toBeInstanceOf(UsageLimitReached);
    expect(classifyFailure({ text: "API Error: 529 Overloaded" })).toBeInstanceOf(ClaudeBusy);
    expect(classifyFailure({ text: "x", apiStatus: 500 })).toBeInstanceOf(ClaudeBusy);
  });
  it("says when the limit resets: a time today, or the day and time", () => {
    const now = new Date(2026, 10, 18, 9, 0);
    expect(resetTime(new Date(2026, 10, 18, 15, 0), now)).toMatch(/^3:00\s?pm$/i);
    expect(resetTime(new Date(2026, 10, 19, 15, 30), now)).toMatch(/^Thursday at 3:30\s?pm$/i);
  });
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

  it("background calls never take the last places: a call the student waits for starts at once beside them", async () => {
    setConcurrency(3, 2);
    const b1 = await acquire(undefined, "background");
    const b2 = await acquire(undefined, "background");
    let third = false;
    const b3 = acquire(undefined, "background").then((r) => ((third = true), r));
    const now = await acquire(undefined, "now"); // the third place is free for it, though a background call asked first
    await new Promise((r) => setTimeout(r, 5));
    expect(third).toBe(false);
    expect(stats()).toEqual({ running: 3, waiting: 1 });
    b1();
    (await b3)();
    b2();
    now();
    expect(stats()).toEqual({ running: 0, waiting: 0 });
  });

  it("a waiting background call whose layer the student opens moves up: it starts in a place background calls can't take", async () => {
    setConcurrency(2, 1);
    const hold = await acquire(undefined, "background");
    const other = await acquire(undefined, "now");
    let opened = false;
    let started = false;
    const waiting = acquire(undefined, () => (opened ? "now" : "background")).then((r) => ((started = true), r));
    other();
    await new Promise((r) => setTimeout(r, 5));
    expect(started).toBe(false); // the one free place is not for background work
    opened = true;
    requeue();
    (await waiting)();
    expect(started).toBe(true);
    hold();
  });

  it("when places free up, waiting calls for the student go before waiting background calls", async () => {
    setConcurrency(1, 1);
    const first = await acquire(undefined, "now");
    const order: string[] = [];
    const bg = acquire(undefined, "background").then((r) => (order.push("background"), r));
    const now = acquire(undefined, "now").then((r) => (order.push("now"), r));
    first();
    (await now)();
    (await bg)();
    expect(order).toEqual(["now", "background"]);
  });
});

describe("buildArgs and model config", () => {
  it("passes the flags from CLAUDE.md, the prompt is not an argument", () => {
    const args = buildArgs({ system: "SYS", prompt: "LONG PROMPT" });
    expect(args).toEqual(expect.arrayContaining(["-p", "--verbose", "--include-partial-messages", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--safe-mode", "--no-chrome"]));
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
    const { explainedSchema, layerBreakdownSchema, pickSourceSchema, reviewSchema, brainNotesSchema, notePickSchema } = await import("@/lib/ai/schemas");
    for (const schema of [explainedSchema, layerBreakdownSchema, pickSourceSchema, reviewSchema, brainNotesSchema, notePickSchema]) {
      const out = toCliSchema(schema) as Record<string, unknown>;
      expect(out.$schema).toBeUndefined();
      expect(out.type).toBe("object");
    }
  });

  it("defaults: reviews, reading the folder and the course plan use Opus 5.5 at medium; Explained and Source at low, for speed; Let's talk! uses sonnet", () => {
    expect(modelFor("review", {})).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("explain", {})).toEqual({ model: "claude-opus-5-5", effort: "low" });
    expect(modelFor("structure", {})).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("organize", {})).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("check", {})).toEqual({ model: "claude-opus-5-5", effort: "low" }); // the final look over a sorted course
    expect(modelFor("talk", {})).toEqual({ model: "sonnet" });
  });

  it("env overrides model and effort; junk effort falls back; 'default' drops it", () => {
    expect(modelFor("review", { MARGIN_MODEL_REVIEW: "sonnet", MARGIN_EFFORT_REVIEW: "high" })).toEqual({ model: "sonnet", effort: "high" });
    expect(modelFor("review", { MARGIN_EFFORT_REVIEW: "banana" })).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(modelFor("review", { MARGIN_EFFORT_REVIEW: "default" })).toEqual({ model: "claude-opus-5-5" });
    expect(modelFor("structure", { MARGIN_EFFORT_STRUCTURE: "low" })).toEqual({ model: "claude-opus-5-5", effort: "low" }); // faster plans
    expect(modelFor("structure", { MARGIN_MODEL_STRUCTURE: "sonnet", MARGIN_EFFORT_STRUCTURE: "default" })).toEqual({ model: "sonnet" });
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
  if (mode === "limit-rejected") {
    // the plan's window as Claude Code reports it, then an error whose words say nothing about limits
    process.stdout.write(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1794385200, rateLimitType: "five_hour" } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Request failed" }) + "\\n");
    process.exit(1);
  }
  if (mode === "busy") {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 529, result: "API Error: 529 Overloaded" }) + "\\n");
    process.exit(1);
  }
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
    // Isolation: an empty temporary folder outside the project, so no CLAUDE.md, settings or skills can be found in it or above it.
    expect(path.basename(call.cwd).startsWith("margin-claude-")).toBe(true);
    expect(call.cwd.startsWith(realpathSync(process.cwd()))).toBe(false);
    expect(call.cwd.startsWith(realpathSync(os.tmpdir()))).toBe(true);
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

  it("a usage window Claude Code reports as rejected is the usage limit, with the time it resets, whatever the error says", async () => {
    env("limit-rejected");
    const e = await new ClaudeCodeEngine().complete({ system: "s", prompt: "p" }).catch((x) => x);
    expect(e).toBeInstanceOf(UsageLimitReached);
    expect(e.resetsAt).toEqual(new Date(1794385200 * 1000));
    expect(e.message).toMatch(/usage limit has been reached\. It resets at .+\. Wait for it to reset, then try again\./);
  });

  it("an overloaded API is 'Claude is busy', not a raw error", async () => {
    env("busy");
    const e = await new ClaudeCodeEngine().complete({ system: "s", prompt: "p" }).catch((x) => x);
    expect(e).toBeInstanceOf(ClaudeBusy);
    expect(e.message).toBe("Claude is very busy right now and couldn't answer. Wait a minute, then try again.");
  });

  it("a claude that goes quiet is stopped after the idle limit, killed, and its slot freed: never a wait forever", async () => {
    env("hang");
    process.env.MARGIN_AI_IDLE_S = "1.5"; // long enough for the fake claude (a node script) to start and note its pid
    try {
      const started = Date.now();
      const e = await new ClaudeCodeEngine().complete({ system: "s", prompt: "p" }).catch((x) => x);
      expect(e).toBeInstanceOf(EngineTimeout);
      expect(e.message).toMatch(/stopped answering .* so Margin stopped waiting\. Try again\./);
      expect(Date.now() - started).toBeLessThan(5000);
      const pid = Number(readFileSync(path.join(dir, "pid"), "utf8"));
      await new Promise((r) => setTimeout(r, 100));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(stats().running).toBe(0);
    } finally {
      delete process.env.MARGIN_AI_IDLE_S;
    }
  });

  it("logs one line per call: task, model, effort, size, time and outcome, never the prompt", async () => {
    env(`fixture:${path.join(FX, "stream-text.jsonl")}`);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
    try {
      await new ClaudeCodeEngine().complete({ system: "s", prompt: "a secret prompt", model: "claude-opus-5-5", effort: "medium", task: "explain" });
      env("error-result:Claude AI usage limit reached");
      await new ClaudeCodeEngine().complete({ system: "s", prompt: "p", task: "review" }).catch(() => {});
    } finally {
      log.mockRestore();
    }
    expect(lines[0]).toMatch(/^\[margin ai\] explain · claude-opus-5-5 · medium · sent 16 chars · \d+\.\ds · ok · tokens in \d/);
    expect(lines[1]).toMatch(/^\[margin ai\] review · sonnet · sent 2 chars · .* · failed: UsageLimitReached/);
    expect(lines.join("\n")).not.toContain("secret");
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

describe("structured answers", () => {
  it("a quotation left with its JSON escaping (\\\"like this\\\") shows without the backslashes, in every string of the answer", async () => {
    const { unescapeQuotes } = await import("@/lib/ai/claude-code-engine");
    expect(unescapeQuotes({ soWhat: 'a people choosing \\"from reflection and choice\\"', fixes: [{ text: "keep \\“this\\”" }], n: 3 })).toEqual({ soWhat: 'a people choosing "from reflection and choice"', fixes: [{ text: "keep “this”" }], n: 3 });
    expect(unescapeQuotes("a path C:\\files stays")).toBe("a path C:\\files stays");
  });
});
