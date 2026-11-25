// @vitest-environment node
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cannedEngine, cannedJson, cannedText } from "@/lib/ai/canned";
import type { AiRequest } from "@/lib/ai/engine";
import { UsageLimitReached } from "@/lib/ai/errors";
import { FakeEngine } from "@/lib/ai/fake-engine";
import { openDb, type Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { focusLayer, pendingLayers, readyCount, requestLayer, startBackground, stopBackground, writingOrder, writingStatus } from "@/lib/layers/background";
import { watchProgress, type LayerProgress } from "@/lib/layers/layer-progress";
import { approvePlan, getStructure, proposeStructure } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";
import { longReading } from "../fixtures/long-reading";

// Background writing, with the fake engine and a temporary data folder: the order, jumping the queue, the usage limit and a restart.

const enc = (t: string) => new TextEncoder().encode(t);
let db: Db;
let projectId: string;
let dir: string;

async function until(ok: () => boolean, ms = 8_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const status = (id: string) => db.select({ v: s.layers.contentStatus }).from(s.layers).where(eq(s.layers.id, id)).get()!.v;
const writingNow = () => db.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.contentStatus, "writing")).all().map((r) => r.id);
const allLayers = () => getStructure(db, projectId)!.weeks.flatMap((w) => w.layers.map((l) => l.id));

/** The fake engine, slowed a little, recording which layer each call was for, how many calls ran at once and how many layers were written at once. */
function recordingEngine(opts: { delayMs?: number; fail?: (req: AiRequest) => Error | null } = {}) {
  const order: string[] = [];
  let running = 0;
  let most = 0;
  let mostLayers = 0;
  const seeing = (req: AiRequest) => {
    const e = opts.fail?.(req);
    if (e) throw e;
    const now = writingNow();
    mostLayers = Math.max(mostLayers, now.length);
    for (const id of now) if (!order.includes(id)) order.push(id);
  };
  const engine = new FakeEngine({
    delayMs: opts.delayMs ?? 15,
    json: (req: AiRequest) => (seeing(req), cannedJson(req)),
    text: (req: AiRequest) => (seeing(req), cannedText(req)),
  });
  const json = engine.json.bind(engine);
  engine.json = async <T,>(req: AiRequest, schema: Parameters<typeof json<T>>[1], signal?: AbortSignal) => {
    running++;
    most = Math.max(most, running);
    try {
      return await json(req, schema, signal);
    } finally {
      running--;
    }
  };
  return { engine, order, most: () => most, mostLayers: () => mostLayers };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "margin-background-"));
  process.env.MARGIN_DATA_DIR = dir;
  db = openDb(":memory:").db;
  projectId = createProject(db, { name: "BG101 Made-up course" });
  // made-up text only: four weeks of two readings each
  for (let w = 1; w <= 4; w++)
    for (const n of [1, 2]) await addFile(db, projectId, { name: `Reading ${w}${n}.txt`, relPath: `Week ${w}/Reading ${w}${n}.txt`, bytes: enc(longReading({ words: 1_500, seed: w * 10 + n })) });
  await analyzeProject(db, cannedEngine(), projectId);
  await proposeStructure(db, cannedEngine(), projectId);
});

afterEach(() => {
  stopBackground();
});

describe("the order layers are written in", () => {
  it("the current week first, then the next week, then the rest of the course in week order; written layers are skipped", () => {
    const weeks = [1, 2, 3, 4, 5].map((week) => ({ week, layers: [`${week}a`, `${week}b`].map((id) => ({ id, written: id === "3b" })) }));
    expect(writingOrder(weeks, 3)).toEqual(["3a", "4a", "4b", "1a", "1b", "2a", "2b", "5a", "5b"]);
    expect(writingOrder(weeks, 5)).toEqual(["5a", "5b", "1a", "1b", "2a", "2b", "3a", "4a", "4b"]);
  });

  it("nothing is queued until the plan is approved; then every layer, starting with the course's current week", () => {
    expect(pendingLayers(db)).toEqual([]);
    approvePlan(db, projectId);
    const model = getStructure(db, projectId)!;
    const pending = pendingLayers(db);
    expect(new Set(pending)).toEqual(new Set(allLayers()));
    const current = model.weeks.find((w) => w.week === model.currentWeek)!;
    expect(pending.slice(0, current.layers.length)).toEqual(current.layers.map((l) => l.id));
  });
});

describe("background writing", () => {
  it("writes every layer on its own after approval, one layer at a time, in queue order, beside the brain, and counts them as ready", async () => {
    approvePlan(db, projectId);
    const expected = pendingLayers(db);
    const { engine, order, mostLayers } = recordingEngine({ delayMs: 1 });
    expect(readyCount(db, projectId)).toEqual({ ready: 0, total: expected.length });
    startBackground({ db: () => db, engine: () => engine, delayMs: 0, idleMs: 20 });
    await until(() => readyCount(db, projectId).ready === expected.length && !writingStatus(db, projectId).brain.building, 15_000);
    expect(order).toEqual(expected);
    expect(mostLayers()).toBe(1);
    // the brain read the course side by side with the layers, not after them
    const brainCalls = engine.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.task === "brain");
    const lastLayerCall = engine.calls.map((c) => c.task).lastIndexOf("explain");
    expect(brainCalls.length).toBeGreaterThan(0);
    expect(brainCalls[0].i).toBeLessThan(lastLayerCall);
    expect(writingStatus(db, projectId)).toMatchObject({ ready: expected.length, total: expected.length, pausedUntil: null, brain: { building: false } });
  });

  it("a layer the student opens is written at once, beside the layer the background is writing, then the next one in its week goes first", async () => {
    approvePlan(db, projectId);
    const pending = pendingLayers(db);
    const { engine, order } = recordingEngine({ delayMs: 40 });
    startBackground({ db: () => db, engine: () => engine, delayMs: 0, idleMs: 20 });
    await until(() => order.length === 1); // the worker is busy with the first layer
    // the student opens a layer far down the queue that has a next layer in its week
    const model = getStructure(db, projectId)!;
    const week = model.weeks.filter((w) => w.layers.length > 1).find((w) => !w.layers.slice(0, 2).some((l) => pending.indexOf(l.id) < 3))!;
    const [wanted, after] = week.layers.map((l) => l.id);
    const busy = order[0];
    const seen: LayerProgress[] = [];
    const job = requestLayer(db, engine, wanted);
    watchProgress(wanted, (p) => seen.push(structuredClone(p)));
    expect(seen[0].steps.source).toBe("working"); // never waiting its turn
    expect(writingNow().sort()).toEqual([busy, wanted].sort());
    await job;
    expect(status(wanted)).toBe("ready");
    await until(() => order.length >= 3);
    expect(order.slice(1, 3)).toEqual([wanted, after]);
    expect(seen.some((p) => p.text.length > 0)).toBe(true);
  });

  it("opening a written layer puts the next one in its week first", async () => {
    approvePlan(db, projectId);
    const pending = pendingLayers(db);
    const { engine, order } = recordingEngine({ delayMs: 30 });
    startBackground({ db: () => db, engine: () => engine, delayMs: 0, idleMs: 20 });
    await until(() => order.length === 1);
    const target = getStructure(db, projectId)!.weeks.find((w) => w.layers.length > 1 && pending.indexOf(w.layers[1].id) > 2)!.layers;
    focusLayer(db, target[0].id);
    await until(() => order.length >= 3);
    expect(order.slice(1, 3)).toEqual([target[0].id, target[1].id]);
  });

  it("pauses quietly at the usage limit, keeps what was written, refuses at once with the reset time, and resumes on its own after the reset", async () => {
    approvePlan(db, projectId);
    const total = pendingLayers(db).length;
    let limited = false;
    let resetsAt = new Date(0);
    let calls = 0;
    const { engine } = recordingEngine({
      fail: () => {
        calls++;
        // the limit is hit while the third layer is written
        if (!limited && readyCount(db, projectId).ready === 2) {
          limited = true;
          resetsAt = new Date(Date.now() + 300);
        }
        return limited && Date.now() < resetsAt.getTime() ? new UsageLimitReached(resetsAt) : null;
      },
    });
    startBackground({ db: () => db, engine: () => engine, delayMs: 0, idleMs: 20, afterResetMs: 50 });
    await until(() => writingStatus(db, projectId).pausedUntil !== null);
    expect(readyCount(db, projectId).ready).toBe(2); // finished layers are kept
    expect(JSON.parse(fs.readFileSync(path.join(dir, "background-writing.json"), "utf8")).pausedUntil).toBe(resetsAt.getTime() + 50);
    // while paused, a student opening a layer hears the reset time at once, and Claude is not asked
    const before = calls;
    const waiting = pendingLayers(db)[0];
    expect(() => requestLayer(db, engine, waiting)).toThrow(UsageLimitReached);
    expect(calls).toBe(before);
    expect(writingNow()).toEqual([]);
    // after the reset it carries on by itself and finishes the course
    await until(() => readyCount(db, projectId).ready === total);
    expect(writingStatus(db, projectId).pausedUntil).toBeNull();
    expect(fs.existsSync(path.join(dir, "background-writing.json"))).toBe(false);
  });

  it("survives quitting Margin: a layer left half-written goes back to the queue, a pause is remembered, and the rest is written after", async () => {
    approvePlan(db, projectId);
    const pending = pendingLayers(db);
    // a server that wrote two layers, then stopped mid-layer while the usage limit was reached
    const first = recordingEngine();
    startBackground({ db: () => db, engine: () => first.engine, delayMs: 0, idleMs: 20 });
    await until(() => readyCount(db, projectId).ready >= 2);
    stopBackground();
    await until(() => writingNow().length === 0);
    const kept = readyCount(db, projectId).ready;
    const stuck = pendingLayers(db)[0];
    db.update(s.layers).set({ contentStatus: "writing" }).where(eq(s.layers.id, stuck)).run();
    fs.writeFileSync(path.join(dir, "background-writing.json"), JSON.stringify({ pausedUntil: Date.now() + 250 }));

    // Margin opens again
    const second = recordingEngine();
    startBackground({ db: () => db, engine: () => second.engine, delayMs: 0, idleMs: 20, afterResetMs: 0 });
    expect(status(stuck)).toBe("none"); // back in the queue
    expect(writingStatus(db, projectId).pausedUntil).not.toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(second.engine.calls).toHaveLength(0); // still paused: nothing asked
    await until(() => readyCount(db, projectId).ready === pending.length);
    expect(second.order[0]).toBe(stuck);
    expect(second.order).toHaveLength(pending.length - kept);
  });
});
