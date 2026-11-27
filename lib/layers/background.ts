import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Engine } from "@/lib/ai/engine";
import { EngineError, UsageLimitReached, resetTime } from "@/lib/ai/errors";
import type { Db } from "@/lib/db/client";
import { dataDir } from "@/lib/db/paths";
import * as s from "@/lib/db/schema";
import { nextLectureWeek, writeWeekLecture } from "@/lib/lecture/service";
import { checkCoursePages, coursesToCheck } from "@/lib/projects/page-ranges-check";
import { nextBrainFile } from "@/lib/brain/queue";
import { readIntoBrain } from "@/lib/brain/read";
import { brainsToCheck, checkBrainNamesOf } from "@/lib/brain/names-check";
import { brainStatus, type BrainStatus } from "@/lib/brain/store";
import { placeNewPassages } from "@/lib/updates/service";
import { checkLayerConcepts, GateError, getStructure, isWriting, layersAwaitingConcepts, promoteLayer, writeLayerContent } from "./service";

/**
 * Background work, in two lanes that run side by side, so writing a layer never waits behind the brain.
 *
 * The brain lane: one-time checks of older courses (page ranges, then the brain's other names), then the course brain reads every course
 * file in full (`lib/brain`): files a layer being written needs first, then the current week's, the next week's, then the rest.
 *
 * The layer lane: layers the student opened (and the one after each) first; then the named-things check of layers written before the brain
 * had read their files; then week Lecture tabs whose notes or files changed; then, once a course plan is approved, every other layer in
 * course order (current week, next week, the rest), so each is finished before the student reaches it; then the Lecture tabs of weeks
 * whose layers are all written. A layer the student opens is never queued: it is written at once, its calls before any
 * background call (lib/ai/queue.ts).
 *
 * The queue is the database itself (every approved layer not written yet, every unread file), so it survives quitting Margin; only the
 * student's place in it lives in memory. When the Claude plan's usage limit is hit both lanes pause until the reset (kept in a small file
 * in the data folder) and then carry on by themselves.
 */

/** The order to write one course's unwritten layers in: the current week, the next week, then every other week in order. Pure. */
export function writingOrder(weeks: { week: number; layers: { id: string; written: boolean }[] }[], current: number): string[] {
  const rank = (w: number) => (w === current ? 0 : w === current + 1 ? 1 : 2);
  return [...weeks]
    .sort((a, b) => rank(a.week) - rank(b.week) || a.week - b.week)
    .flatMap((w) => w.layers.filter((l) => !l.written).map((l) => l.id));
}

/** Every layer still to write, in order: the course the student last opened first, then the others, newest first. Demo layers come written. */
export function pendingLayers(db: Db, firstProject: string | null = null): string[] {
  const projects = db.select({ id: s.projects.id, createdAt: s.projects.createdAt }).from(s.projects).where(and(eq(s.projects.isDemo, false), eq(s.projects.status, "ready"))).all();
  projects.sort((a, b) => Number(b.id === firstProject) - Number(a.id === firstProject) || b.createdAt - a.createdAt);
  return projects.flatMap((p) => {
    const model = getStructure(db, p.id);
    if (!model) return [];
    const weeks = model.weeks.filter((w) => w.status === "approved").map((w) => ({ week: w.week, layers: w.layers.map((l) => ({ id: l.id, written: l.contentStatus !== "none" })) }));
    return writingOrder(weeks, model.currentWeek);
  });
}

/** "12 of 18 layers ready": the layers of the approved weeks whose tabs are written. */
export function readyCount(db: Db, projectId: string): { ready: number; total: number } {
  const rows = db
    .select({ status: s.layers.contentStatus })
    .from(s.layers)
    .innerJoin(s.parts, eq(s.parts.id, s.layers.partId))
    .where(and(eq(s.parts.projectId, projectId), eq(s.parts.breakdownStatus, "approved"), eq(s.layers.proposed, false)))
    .all();
  return { ready: rows.filter((r) => r.status === "ready").length, total: rows.length };
}

export interface WritingStatus {
  ready: number;
  total: number;
  /** Set while the queue waits for the plan's usage limit to reset: when it starts again, in words ("4:10 pm"). */
  pausedUntil: string | null;
  /** How far the course brain has read: "Margin has read 4 of 12 weeks". */
  brain: BrainStatus;
}

export function writingStatus(db: Db, projectId: string, now = new Date()): WritingStatus {
  const until = state().pausedUntil;
  return { ...readyCount(db, projectId), pausedUntil: until && until > now.getTime() ? resetTime(new Date(until), now) : null, brain: brainStatus(db, projectId) };
}

// ---------------------------------------------------------------- the worker

interface State {
  started: boolean;
  db?: () => Db;
  engine?: () => Engine;
  /** Layers the student opened (and the one after each), most recent first: written before anything else. */
  front: string[];
  firstProject: string | null;
  pausedUntil: number | null;
  /** A layer that failed is left for a while (it is tried again when the student opens it). */
  resting: Map<string, number>;
  /** Each lane's sleep, so a change (a plan approved, a layer opened, the pause lifted) can wake it. */
  wakes: Set<() => void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  stopped: boolean;
  /** How long after the plan's reset time it tries again, and how often an idle queue looks again. */
  afterResetMs: number;
  idleMs: number;
  /** The heartbeat: when it last ticked, and when the computer last woke from sleep (a tick that came far too late). */
  lastBeat: number;
  wokeAt: number;
}
const KEY = "__margin_background_writing__";
const fresh = (): State => ({ started: false, front: [], firstProject: null, pausedUntil: null, resting: new Map(), wakes: new Set(), timers: new Set(), stopped: false, afterResetMs: 30_000, idleMs: 60_000, lastBeat: Date.now(), wokeAt: 0 });
const state = (): State => ((globalThis as unknown as Record<string, State>)[KEY] ??= fresh());

const REST_MS = 30 * 60_000;
/** A limit that says no reset time: try again after this. */
const UNKNOWN_RESET_MS = 30 * 60_000;

const pauseFile = () => path.join(dataDir(), "background-writing.json");
function savePause(until: number | null) {
  try {
    if (until) fs.writeFileSync(pauseFile(), JSON.stringify({ pausedUntil: until }));
    else fs.rmSync(pauseFile(), { force: true });
  } catch {
    // the pause is a convenience: without the file the queue only tries once more after a restart
  }
}
function readPause(): number | null {
  try {
    const v = (JSON.parse(fs.readFileSync(pauseFile(), "utf8")) as { pausedUntil?: unknown }).pausedUntil;
    return typeof v === "number" && v > Date.now() ? v : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  const st = state();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    st.timers.add(t);
    function done() {
      clearTimeout(t);
      st.timers.delete(t);
      st.wakes.delete(done);
      resolve();
    }
    st.wakes.add(done);
  });
}

/** How often the heartbeat ticks, and how late a tick must be to mean the computer slept. */
const BEAT_MS = 10_000;
const SLEPT_MS = 45_000;

/** A tick this late means the computer was asleep in between (timers don't run while a Mac sleeps). Pure. */
export const sleptBetween = (lastBeat: number, now: number, sleptMs = SLEPT_MS) => now - lastBeat > sleptMs;

function heartbeat() {
  const st = state();
  const now = Date.now();
  if (sleptBetween(st.lastBeat, now)) {
    st.wokeAt = now;
    console.log("[margin background] the computer was asleep; carrying on where it stopped");
  }
  st.lastBeat = now;
}

/** Whether the computer slept since `since`: a call that failed across a sleep was interrupted, not wrong, so it is simply tried again. */
export function sleptSince(since: number): boolean {
  heartbeat();
  return state().wokeAt >= since;
}

/** Something changed (a plan approved, a layer opened): look at the queue again now. */
export function kickBackground() {
  for (const wake of [...state().wakes]) wake();
}

function pause(error: UsageLimitReached) {
  const st = state();
  st.pausedUntil = error.resetsAt ? error.resetsAt.getTime() + st.afterResetMs : Date.now() + UNKNOWN_RESET_MS;
  savePause(st.pausedUntil);
  console.log(`[margin background] paused: the Claude usage limit is reached; starting again at ${new Date(st.pausedUntil).toISOString()}`);
}

/** The next layer to write ahead: one the student opened (or the one after it) first, else the first in course order. Null when there is none. */
function pick(db: Db): string | null {
  const st = state();
  const pending = pendingLayers(db, st.firstProject);
  const open = new Set(pending);
  const ok = (id: string) => !isWriting(id) && !((st.resting.get(id) ?? 0) > Date.now());
  st.front = st.front.filter((id) => open.has(id));
  return st.front.find(ok) ?? pending.find(ok) ?? null;
}

async function writeOne(db: Db, engine: Engine, layerId: string) {
  const st = state();
  const started = Date.now();
  try {
    await writeLayerContent(db, engine, layerId, { priority: "background" });
    console.log(`[margin background] layer ${layerId} written · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    if (e instanceof UsageLimitReached) return pause(e);
    st.resting.set(layerId, Date.now() + REST_MS);
    const code = e instanceof EngineError ? e.code : e instanceof Error ? e.name : "Failed";
    console.log(`[margin background] layer ${layerId} not written (${code}); tried again later or when it is opened`);
  }
}

/** The named-things check of a layer whose files the brain has now read. A failure leaves it for a while. */
async function conceptStep(db: Db, engine: Engine): Promise<boolean> {
  const st = state();
  const next = layersAwaitingConcepts(db).find((id) => !((st.resting.get(`concepts:${id}`) ?? 0) > Date.now()));
  if (!next) return false;
  try {
    const added = await checkLayerConcepts(db, engine, next);
    console.log(`[margin background] layer ${next} named-things check · ${added} added`);
  } catch (e) {
    if (e instanceof UsageLimitReached) pause(e);
    else st.resting.set(`concepts:${next}`, Date.now() + REST_MS);
  }
  return true;
}

/**
 * The week Lecture tab step: a section whose notes or files changed (the notes only once the student stopped editing them), or with
 * `missing` a section never written, in a week whose layers are all written. A failure leaves that week for a while. False: nothing to do.
 */
async function lectureStep(db: Db, engine: Engine, missing: boolean): Promise<boolean> {
  const st = state();
  const next = nextLectureWeek(db, { missing, firstProject: st.firstProject, skip: (p, w) => (st.resting.get(`lecture:${p}:${w}`) ?? 0) > Date.now() });
  if (!next) return false;
  const started = Date.now();
  try {
    await writeWeekLecture(db, engine, next.projectId, next.week, { quietOnly: true });
    console.log(`[margin background] week ${next.week} Lecture tab written · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    if (e instanceof UsageLimitReached) pause(e);
    else {
      st.resting.set(`lecture:${next.projectId}:${next.week}`, Date.now() + REST_MS);
      console.log(`[margin background] week ${next.week} Lecture tab not written (${e instanceof EngineError ? e.code : e instanceof Error ? e.name : "Failed"}); tried again later or when it is opened`);
    }
  }
  return true;
}

/**
 * Read the next file into the course brain. A call that fails because the computer went to sleep part-way is tried again at once; the
 * usage limit pauses the queue; any other failure leaves the file for a while. Returns false when there is nothing to read.
 */
export async function brainStep(db: Db, engine: Engine): Promise<boolean> {
  const st = state();
  const next = nextBrainFile(db, st.firstProject, (id) => (st.resting.get(`brain:${id}`) ?? 0) > Date.now());
  if (!next) return false;
  const started = Date.now();
  try {
    const { notes } = await readIntoBrain(db, engine, next.fileId);
    console.log(`[margin brain] file ${next.fileId} read · ${notes} notes · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    if (e instanceof UsageLimitReached) pause(e);
    else if (sleptSince(started)) console.log(`[margin brain] file ${next.fileId} was interrupted by sleep; reading it again`);
    else {
      st.resting.set(`brain:${next.fileId}`, Date.now() + REST_MS);
      console.log(`[margin brain] file ${next.fileId} not read (${e instanceof EngineError ? e.code : e instanceof Error ? e.name : "Failed"}); tried again later`);
    }
  }
  return true;
}

async function checkPages(db: Db, engine: Engine, projectId: string) {
  try {
    await checkCoursePages(db, engine, projectId, (d, e, p) => placeNewPassages(d, e, p, undefined, { approveNew: true }));
  } catch (e) {
    if (e instanceof UsageLimitReached) return pause(e);
    state().resting.set(`pages:${projectId}`, Date.now() + REST_MS);
    console.log(`[margin background] page ranges of ${projectId} not checked (${e instanceof EngineError ? e.code : e instanceof Error ? e.name : "Failed"}); tried again later`);
  }
}

async function checkNames(db: Db, engine: Engine, projectId: string) {
  try {
    await checkBrainNamesOf(db, engine, projectId);
  } catch (e) {
    if (e instanceof UsageLimitReached) return pause(e);
    state().resting.set(`names:${projectId}`, Date.now() + REST_MS);
    console.log(`[margin background] other names of ${projectId} not checked (${e instanceof EngineError ? e.code : e instanceof Error ? e.name : "Failed"}); tried again later`);
  }
}

/** The first course (if any) with a one-time check still to run that isn't resting after a failure. */
function firstToCheck(list: (db: Db) => string[], db: Db, tag: string): string | null {
  try {
    return list(db).find((p) => !((state().resting.get(`${tag}:${p}`) ?? 0) > Date.now())) ?? null;
  } catch {
    return null;
  }
}

/** Wait while the plan's usage limit holds. Returns false when the worker stopped meanwhile. */
async function waitOutPause(st: State): Promise<boolean> {
  while (st.pausedUntil && !st.stopped) {
    if (st.pausedUntil > Date.now()) {
      await sleep(Math.min(st.pausedUntil - Date.now(), 2 ** 31 - 1));
      continue;
    }
    st.pausedUntil = null;
    savePause(null);
    kickBackground();
  }
  return !st.stopped;
}

/** The brain lane: older courses' one-time checks, then the brain reads the next file. */
async function brainLane() {
  const st = state();
  while (await waitOutPause(st)) {
    const db = st.db!();
    // a course imported before one file's pages could be split between weeks is checked once, before its brain is read; then a brain
    // read before the stricter other-names rule is checked once for wrong merges
    const course = firstToCheck(coursesToCheck, db, "pages");
    if (course) {
      await checkPages(db, st.engine!(), course);
      continue;
    }
    const brain = firstToCheck(brainsToCheck, db, "names");
    if (brain) {
      await checkNames(db, st.engine!(), brain);
      continue;
    }
    let read = false;
    try {
      read = await brainStep(db, st.engine!());
    } catch (e) {
      console.log(`[margin background] could not read the brain's queue: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!read) await sleep(st.idleMs);
  }
}

/** The layer lane: layers the student is heading for, named-things checks the brain has caught up with, changed Lecture tabs, the rest of the layers, then new Lecture tabs. */
async function layerLane() {
  const st = state();
  while (await waitOutPause(st)) {
    const db = st.db!();
    let next: string | null = null;
    try {
      const front = st.front.find((id) => !isWriting(id) && pendingLayers(db, st.firstProject).includes(id) && !((st.resting.get(id) ?? 0) > Date.now()));
      if (!front && (await conceptStep(db, st.engine!()))) continue;
      // a week's Lecture tab whose notes or files changed comes before writing ahead; one never written comes after every layer
      if (!front && (await lectureStep(db, st.engine!(), false))) continue;
      next = front ?? pick(db);
      if (!next && (await lectureStep(db, st.engine!(), true))) continue;
    } catch (e) {
      console.log(`[margin background] could not read the layer queue: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!next) {
      await sleep(st.idleMs);
      continue;
    }
    await writeOne(db, st.engine!(), next);
    st.front = st.front.filter((id) => id !== next);
  }
}

/**
 * Start the worker, once per server. A layer left "writing" by a server that stopped mid-way goes back to waiting (or to its old tabs).
 * `delayMs` lets the server finish starting first.
 */
export function startBackground({ db, engine, delayMs = 5_000, afterResetMs = 30_000, idleMs = 60_000 }: { db: () => Db; engine: () => Engine; delayMs?: number; afterResetMs?: number; idleMs?: number }) {
  const st = state();
  if (st.started) return;
  st.afterResetMs = afterResetMs;
  st.idleMs = idleMs;
  st.started = true;
  st.stopped = false;
  st.db = db;
  st.engine = engine;
  st.pausedUntil = readPause();
  st.lastBeat = Date.now();
  const beat = setInterval(heartbeat, BEAT_MS);
  beat.unref?.();
  st.timers.add(beat as unknown as ReturnType<typeof setTimeout>);
  const d = db();
  const stuck = d.select({ id: s.layers.id }).from(s.layers).where(eq(s.layers.contentStatus, "writing")).all().map((r) => r.id).filter((id) => !isWriting(id));
  if (stuck.length) {
    const hasTabs = new Set(d.select({ id: s.layerContent.layerId }).from(s.layerContent).where(inArray(s.layerContent.layerId, stuck)).all().map((r) => r.id));
    for (const id of stuck) d.update(s.layers).set({ contentStatus: hasTabs.has(id) ? "ready" : "none" }).where(eq(s.layers.id, id)).run();
  }
  const t = setTimeout(() => {
    st.timers.delete(t);
    void brainLane();
    void layerLane();
  }, delayMs);
  st.timers.add(t);
}

/** Stop the worker (tests). Whatever is being written finishes on its own. */
export function stopBackground() {
  const st = state();
  st.stopped = true;
  for (const t of st.timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  kickBackground();
  (globalThis as unknown as Record<string, State | undefined>)[KEY] = undefined;
}

/** The student opened a layer: it and the next one in its week go to the front of the queue. */
export function focusLayer(db: Db, layerId: string) {
  const st = state();
  if (!st.started) return;
  const layer = db.select({ partId: s.layers.partId, position: s.layers.position }).from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (!layer) return;
  const part = db.select({ projectId: s.parts.projectId }).from(s.parts).where(eq(s.parts.id, layer.partId)).get();
  const next = db
    .select({ id: s.layers.id })
    .from(s.layers)
    .where(and(eq(s.layers.partId, layer.partId), eq(s.layers.proposed, false), sql`${s.layers.position} > ${layer.position}`))
    .orderBy(s.layers.position)
    .get();
  const ids = [layerId, ...(next ? [next.id] : [])];
  st.front = [...ids, ...st.front.filter((id) => !ids.includes(id))];
  st.firstProject = part?.projectId ?? st.firstProject;
  kickBackground();
}

/**
 * The student opened a layer that isn't written: it is written at once, its calls ahead of any background call, side by side with the
 * brain. A layer already being written (ahead, in the background) is joined. While the usage limit holds it fails at once with the reset
 * time, without asking Claude; a limit hit while writing pauses the background too.
 */
export function requestLayer(db: Db, engine: Engine, layerId: string): Promise<void> {
  const st = state();
  const layer = db.select({ partId: s.layers.partId }).from(s.layers).where(eq(s.layers.id, layerId)).get();
  if (layer) {
    const part = db.select({ status: s.parts.breakdownStatus }).from(s.parts).where(eq(s.parts.id, layer.partId)).get();
    if (part?.status !== "approved") throw new GateError("Approve the course plan first. Nothing is written until you do.");
  }
  if (!isWriting(layerId) && st.started && st.pausedUntil && st.pausedUntil > Date.now()) throw new UsageLimitReached(new Date(st.pausedUntil));
  focusLayer(db, layerId);
  promoteLayer(layerId); // written ahead already: it goes first from now on
  return writeLayerContent(db, engine, layerId, { priority: "now" }).catch((e: unknown) => {
    if (e instanceof UsageLimitReached && st.started) pause(e);
    throw e;
  });
}
