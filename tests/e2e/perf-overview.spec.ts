import { expect, test, type Browser, type CDPSession, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Scrolling the course page's scenes, measured scene by scene. Off by default (PERF=1 turns it on), meant for the production build
 * (E2E_PROD=1) in installed Chrome with a window and the GPU (PERF_CHROME=1), as Margin.app draws. Self-contained on purpose: the same
 * file runs against an older checkout to compare.
 *
 * The page is scrolled from the top to the end of the Layers tab with the mouse wheel at a steady, reading pace, while every animation
 * frame's time and the scroll position are recorded; frames are then grouped by the scene on screen (the opening, each week). Chrome's
 * own trace gives the main thread's work. Then the same scroll is filmed (a CDP screencast) for frame strips of each scene.
 *
 *   PERF_VW / PERF_VH / PERF_DPR   window size and pixel density (default 1440 x 900 at 1x)
 *   PERF_PROJECT=demo|seeded       the demo course (pre-written) or the sample course imported fresh (default demo)
 *   PERF_BUSY=1                    background writing runs during the scroll (start the server with E2E_BACKGROUND=on and a
 *                                  MARGIN_FAKE_DELAY_MS so the fake engine's queue stays busy); checks the queue is really working
 *   PERF_LOCKIN=1                  lock in instead of the scenes; PERF_TAB=lecture-notes|note-to-self another tab
 *   PERF_LABEL                     names the results file: test-results/perf-overview-<label>.json, strips in test-results/strips-<label>
 *   PERF_JANK=<ms>                 blocks the page's own thread for that long every 80 ms during the scroll (a busy page): whatever
 *                                  still moves is moved by the compositor
 *   PERF_FRAMES=<dir>              saves every filmed frame there with the compositor's scroll position (frames.json), to count frames
 *                                  where the scroll moved but a scene's moving parts did not
 */
test.skip(process.env.PERF !== "1", "PERF=1 runs the scroll measurements");
const VW = Number(process.env.PERF_VW ?? 1440);
const VH = Number(process.env.PERF_VH ?? 900);
const DPR = Number(process.env.PERF_DPR ?? 1);
test.use({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, ...(process.env.PERF_CHROME === "1" ? { channel: "chrome", headless: false } : {}) });
test.setTimeout(600_000);

const dataDir = () => process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "margin-e2e-data");
const db = () => new Database(path.join(dataDir(), "margin.db"), { readonly: true });
const SAMPLE = path.join("demo", "sample-course", "POL101 Federalist Seminar");

async function seed(request: import("@playwright/test").APIRequestContext) {
  const post = async (url: string, init?: Parameters<typeof request.post>[1]) => {
    const r = await request.post(url, init);
    if (!r.ok()) throw new Error(`${url}: ${r.status()} ${await r.text()}`);
    return r;
  };
  const { id } = (await (await post("/api/projects", { data: { name: "POL101 Federalist Seminar", courseCode: "POL101" } })).json()) as { id: string };
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(SAMPLE)) await post(`/api/projects/${id}/files`, { multipart: { file: { name: path.basename(file), mimeType: "application/octet-stream", buffer: fs.readFileSync(file) }, relPath: path.relative(SAMPLE, file) } });
  await post(`/api/projects/${id}/analyze`);
  await post(`/api/projects/${id}/finish`);
  await post(`/api/projects/${id}/structure/propose`, { timeout: 120_000 });
  await post(`/api/projects/${id}/structure/approve`, { data: {} });
  return id;
}

const written = (id: string) => {
  const d = db();
  try {
    return Number((d.prepare("select count(*) n from layer_content c join layers l on l.id = c.layer_id join parts p on p.id = l.part_id where p.project_id = ? and c.explained is not null").get(id) as { n: number }).n);
  } catch {
    return -1;
  } finally {
    d.close();
  }
};

type Frame = { dt: number; y: number };
type SceneStat = { scene: string; frames: number; fps: number; longest: number; slow: number; partial?: number; dropped?: number; shown?: number };

type Range = { name: string; from: number; to: number };

async function record(page: Page, browser: Browser, label: string, filmed: boolean, cdp: CDPSession, ranges: Range[]) {
  await page.mouse.move(VW / 2, VH / 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  const shots: { t: number; data: string; y: number }[] = [];
  const onFrame = (f: { data: string; sessionId: number; metadata: { timestamp?: number; scrollOffsetY?: number } }) => {
    shots.push({ t: f.metadata.timestamp ?? 0, data: f.data, y: f.metadata.scrollOffsetY ?? 0 });
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  };
  if (filmed) {
    cdp.on("Page.screencastFrame", onFrame);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 480, maxHeight: 320, everyNthFrame: 1 });
  }
  const tracePath = path.join("test-results", `perf-overview-${label}.trace.json`);
  if (!filmed) await browser.startTracing(page, { path: tracePath, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "benchmark", "cc", "blink.user_timing", "gpu", "viz", "toplevel"] });
  // each frame's time and scroll position; a mark in the trace whenever a new scene takes over, so Chrome's own frame reports can be
  // grouped by scene too
  await page.evaluate((froms) => {
    const w = window as unknown as { __f: { dt: number; y: number }[]; __stop: boolean };
    w.__f = [];
    w.__stop = false;
    let last = performance.now();
    let scene = -1;
    const tick = (t: number) => {
      const y = window.scrollY;
      w.__f.push({ dt: t - last, y });
      let k = 0;
      for (let i = 1; i < froms.length; i++) if (y > froms[i]) k = i;
      if (k !== scene) performance.mark(`perf-scene-${(scene = k)}`);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // style writes while scrolling, by where they land: in the scene on screen or its neighbours, or in a scene further away (which
    // should never move), or in the backdrop
    const m = ((window as unknown as { __m: Record<string, number> }).__m = { near: 0, far: 0, backdrop: 0, other: 0 });
    const scenes = [...document.querySelectorAll<HTMLElement>(".ov-main > .ov-intro, .ov-main .ov-scene")];
    new MutationObserver((list) => {
      for (const r of list) {
        const el = r.target as HTMLElement;
        if (el.closest?.(".bd")) m.backdrop++;
        else {
          const at = scenes.findIndex((s) => s.contains(el));
          if (at < 0) m.other++;
          else if (Math.abs(at - scene) <= 1) m.near++;
          else m.far++;
        }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["style"], subtree: true });
  }, ranges.map((r) => r.from));
  const end = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const jank = Number(process.env.PERF_JANK ?? 0);
  if (jank) await page.evaluate((ms) => void ((window as unknown as { __jank: number }).__jank = window.setInterval(() => { const t = performance.now(); while (performance.now() - t < ms); }, 80)), jank);
  const startUrl = page.url();
  // a steady reading pace: 25 px a wheel tick, one tick every 16 ms (about 1,500 px a second), until the end of the scenes
  for (let i = 0; i < 2000; i++) {
    await page.mouse.wheel(0, 25);
    await page.waitForTimeout(16);
    if (page.url() !== startUrl) throw new Error(`left the course page mid-scroll, for ${page.url()} (wheel tick ${i})`);
    if (i % 20 === 0 && (await page.evaluate(() => window.scrollY)) >= end - 4) break;
  }
  if (jank) await page.evaluate(() => window.clearInterval((window as unknown as { __jank: number }).__jank));
  await page.waitForTimeout(500);
  if (!filmed) await browser.stopTracing();
  if (filmed) {
    await cdp.send("Page.stopScreencast");
    cdp.off("Page.screencastFrame", onFrame);
    const dir = process.env.PERF_FRAMES;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      shots.forEach((f, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64")));
      fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ vh: VH, ranges, frames: shots.map((f, i) => ({ i, t: f.t, y: f.y })) }));
    }
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __f: { dt: number; y: number }[]; __stop: boolean };
    w.__stop = true;
    return w.__f.slice(2);
  });
  const writes = await page.evaluate(() => (window as unknown as { __m: Record<string, number> }).__m);
  let trace: Record<string, number> = {};
  const dropped: { reported: number; dropped: number; partial: number }[] = ranges.map(() => ({ reported: 0, dropped: 0, partial: 0 }));
  if (!filmed) {
    type Report = { state?: string };
    type Ev = { name: string; dur?: number; ph: string; ts: number; pid: number; tid: number; args?: { name?: string; frame_reporter?: Report; chrome_frame_reporter?: Report } };
    const events = (JSON.parse(fs.readFileSync(tracePath, "utf8")) as { traceEvents: Ev[] }).traceEvents;
    trace = {};
    // busy time of the page's main thread, the GPU process's main thread and the display compositor, each counted once (top-level tasks)
    const threads = new Map<string, string>();
    for (const e of events) if (e.name === "thread_name" && ["CrRendererMain", "CrGpuMain", "VizCompositorThread", "Compositor"].includes(e.args?.name ?? "")) threads.set(`${e.pid}:${e.tid}`, e.args!.name!);
    const busy: Record<string, { end: number; ms: number }> = {};
    for (const e of [...events].filter((x) => x.ph === "X" && x.dur && threads.has(`${x.pid}:${x.tid}`)).sort((a, b) => a.ts - b.ts)) {
      const b = (busy[`${e.pid}:${e.tid}`] ??= { end: 0, ms: 0 });
      if (e.ts >= b.end) {
        b.ms += e.dur! / 1000;
        b.end = e.ts + e.dur!;
      }
    }
    for (const [k, v] of Object.entries(busy)) trace[`busy:${threads.get(k)}`] = Math.round((trace[`busy:${threads.get(k)}`] ?? 0) + v.ms);
    for (const e of events) if (e.ph === "X" && e.dur && ["Paint", "RasterTask", "Layout", "UpdateLayoutTree", "PrePaint", "Layerize", "Commit", "FunctionCall", "EventDispatch"].includes(e.name)) trace[e.name] = Math.round(((trace[e.name] ?? 0) + e.dur / 1000) * 10) / 10;
    // Chrome's own verdict on every frame it meant to show, grouped by the scene on screen: dropped, or shown only partly updated (the
    // compositor moved the page but the page's own thread hadn't updated it yet: what a scroll-linked animation lagging the scroll looks like)
    const marks = events.filter((e) => /^perf-scene-\d+$/.test(e.name)).map((e) => ({ ts: e.ts, k: Number(e.name.slice(11)) })).sort((a, b) => a.ts - b.ts);
    const endTs = Math.max(...events.filter((e) => e.name === "PipelineReporter").map((e) => e.ts));
    for (const e of events) {
      if (e.name !== "PipelineReporter" || e.ph !== "b" || !marks.length || e.ts < marks[0].ts || e.ts > endTs) continue;
      let k = marks[0].k;
      for (const m of marks) if (m.ts <= e.ts) k = m.k;
      dropped[k].reported++;
      const state = (e.args?.frame_reporter ?? e.args?.chrome_frame_reporter)?.state ?? "";
      if (/DROPPED/.test(state)) dropped[k].dropped++;
      if (/PARTIAL/.test(state)) dropped[k].partial++;
    }
    if (process.env.PERF_KEEP_TRACE !== "1") fs.rmSync(tracePath, { force: true });
  }
  return { frames, shots, trace, dropped, writes };
}

/** Where each scene starts and ends on the page, by its own scroll range. */
async function sceneRanges(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".ov-main > .ov-intro, .ov-main .ov-scene, .lk-ov section, .ov-main > section, .ov-main .ov-unit")];
    const seen = new Set<HTMLElement>();
    return els
      .filter((el) => (seen.has(el) ? false : (seen.add(el), el.offsetHeight > 200)))
      .map((el, i) => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        const name = el.classList.contains("ov-intro") ? "opening" : (el.querySelector("h2")?.textContent?.split(" · ")[0] ?? `scene ${i}`);
        // a scene is "playing" from when it enters the window until its end leaves the top
        return { name: name.trim().slice(0, 24), from: Math.max(0, top - window.innerHeight), to: top + el.offsetHeight - window.innerHeight * 0.2 };
      });
  });
}

function perScene(frames: Frame[], ranges: { name: string; from: number; to: number }[]): SceneStat[] {
  // frames before the first scroll and after the last are idle: leave them out
  const firstMove = frames.findIndex((f) => f.y > 0);
  let lastMove = frames.length - 1;
  while (lastMove > 0 && frames[lastMove].y === frames[lastMove - 1].y) lastMove--;
  const moving = frames.slice(Math.max(0, firstMove - 1), lastMove + 1);
  // each scene owns the frames from where it starts entering to where the next one starts entering (no frame counted twice)
  return ranges.map((r, i) => {
    const next = ranges[i + 1];
    const from = i === 0 ? -1 : r.from;
    const to = next ? next.from : Infinity;
    const fs = moving.filter((f) => f.y > from && f.y <= to).map((f) => f.dt);
    const total = fs.reduce((a, b) => a + b, 0);
    return { scene: r.name, frames: fs.length, fps: total ? Math.round((fs.length / total) * 10000) / 10 : 0, longest: Math.round(Math.max(0, ...fs) * 10) / 10, slow: fs.filter((d) => d > 25).length };
  });
}

/** A strip of frames for each scene, side by side, from the film: what the scroll looked like, frame by frame. */
async function strips(browser: Browser, shots: { t: number; data: string }[], yAt: (t: number) => number, ranges: { name: string; from: number; to: number }[], dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 400 }, deviceScaleFactor: 1 });
  for (const [i, r] of ranges.entries()) {
    const next = ranges[i + 1];
    const mine = shots.filter((s) => {
      const y = yAt(s.t);
      return y >= (i === 0 ? 0 : r.from) && y < (next ? next.from + (next.from - r.from) * 0.15 : Infinity);
    });
    if (!mine.length) continue;
    const pick = Array.from({ length: Math.min(12, mine.length) }, (_, k) => mine[Math.floor((k * (mine.length - 1)) / Math.max(1, Math.min(12, mine.length) - 1))]);
    const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px;font:12px monospace;color:#bbb">${pick.map((s, k) => `<figure style="margin:0"><img style="width:100%;display:block" src="data:image/jpeg;base64,${s.data}"><figcaption>${k + 1} · ${Math.round((s.t - pick[0].t) * 1000)} ms</figcaption></figure>`).join("")}</body>`;
    await page.setContent(html);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(2, "0")}-${r.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`), fullPage: true });
  }
  await page.close();
}

test("scrolling the course page's scenes, scene by scene", async ({ page, request, browser }) => {
  const label = process.env.PERF_LABEL ?? `${VW}x${VH}@${DPR}`;
  const which = process.env.PERF_PROJECT ?? "demo";
  let id: string;
  if (which === "demo") {
    const r = await request.post("/api/demo");
    id = ((await r.json()) as { id: string }).id;
  } else id = await seed(request);
  const busy = process.env.PERF_BUSY === "1";
  const lockin = process.env.PERF_LOCKIN === "1";
  await page.addInitScript((m) => localStorage.setItem("margin:mode", m), lockin ? "lock-in" : "normal");
  // PERF_CSS adds a style to the page (to measure without one effect)
  if (process.env.PERF_CSS) await page.addInitScript((css) => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: css }))), process.env.PERF_CSS);
  const tab = process.env.PERF_TAB;
  await page.goto(tab ? `/p/${id}/${tab}` : `/p/${id}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".ov-main, .lk-ov").first()).toBeVisible();
  await page.waitForTimeout(2500); // the opening's entrance has played
  const cdp = await page.context().newCDPSession(page);
  // anything that leaves the page mid-scroll ruins the measurement: say what and why
  page.on("pageerror", (e) => console.log("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
  page.on("framenavigated", (f) => f === page.mainFrame() && console.log(new Date().toISOString(), "navigated to", f.url()));
  await cdp.send("Page.enable");
  cdp.on("Page.frameRequestedNavigation", (e) => console.log("navigation requested:", e.reason, e.disposition, e.url));
  const before = busy ? written(id) : 0;
  const runs = Number(process.env.PERF_RUNS ?? 2);
  const ranges = await sceneRanges(page);
  // the display's own frame rate with nothing moving: a Mac on battery, asleep or locked caps it (30 or 60), which caps every number below
  const refresh = await page.evaluate(() => new Promise<number>((done) => {
    const ts: number[] = [];
    const tick = (t: number) => (ts.push(t), ts.length < 61 ? requestAnimationFrame(tick) : done(Math.round(60000 / (ts[60] - ts[0]))));
    requestAnimationFrame(tick);
  }));
  console.log("display refresh with nothing moving:", refresh, "fps");
  const out: { refresh: number; runs: SceneStat[][]; trace: Record<string, number>[]; ranges: typeof ranges; busy?: { writtenBefore: number; writtenAfter: number } } = { refresh, runs: [], trace: [], ranges };
  // PERF_CPU=4 slows the CPU (a laptop also running Claude and the server, roughly)
  if (process.env.PERF_CPU) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.PERF_CPU) });
  for (let r = 0; r < runs; r++) {
    // PERF_PROFILE=1: a CPU profile of the first pass, test-results/perf-overview-<label>.cpuprofile
    const profiling = process.env.PERF_PROFILE === "1" && r === 0;
    if (profiling) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await cdp.send("Profiler.start");
    }
    const { frames, trace, dropped, writes } = await record(page, browser, `${label}-${r}`, false, cdp, ranges);
    console.log("style writes while scrolling:", JSON.stringify(writes));
    if (profiling) fs.writeFileSync(path.join("test-results", `perf-overview-${label}.cpuprofile`), JSON.stringify((await cdp.send("Profiler.stop")).profile));
    out.runs.push(perScene(frames, ranges).map((s, i) => ({ ...s, partial: dropped[i].partial, dropped: dropped[i].dropped, shown: dropped[i].reported })));
    const n = frames.length || 1;
    out.trace.push({ ...trace, frames: n, "main ms/frame": Math.round(((trace["busy:CrRendererMain"] ?? 0) / n) * 100) / 100, "gpu ms/frame": Math.round(((trace["busy:CrGpuMain"] ?? 0) / n) * 100) / 100, "viz ms/frame": Math.round(((trace["busy:VizCompositorThread"] ?? 0) / n) * 100) / 100 });
  }
  if (busy) {
    out.busy = { writtenBefore: before, writtenAfter: written(id) };
    expect(out.busy.writtenAfter, "background writing kept working during the scroll").toBeGreaterThan(before);
  }
  // the film, separately (filming costs frames of its own, so it is never measured)
  if (process.env.PERF_STRIPS !== "0") {
    const { frames, shots } = await record(page, browser, `${label}-film`, true, cdp, ranges);
    // screencast timestamps are seconds; frames' scroll positions are matched to them by time from the first frame
    const t0 = shots[0]?.t ?? 0;
    let acc = 0;
    const timeline = frames.map((f) => ((acc += f.dt), { t: acc / 1000, y: f.y }));
    const span = (shots.at(-1)?.t ?? t0) - t0;
    const scale = span > 0 && acc > 0 ? acc / 1000 / span : 1;
    const yAt = (t: number) => {
      const tt = (t - t0) * scale;
      return (timeline.find((p) => p.t >= tt) ?? timeline.at(-1) ?? { y: 0 }).y;
    };
    await strips(browser, shots, yAt, ranges, path.join("test-results", `strips-${label}`));
  }
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(path.join("test-results", `perf-overview-${label}.json`), JSON.stringify(out, null, 2));
  for (const [k, run] of out.runs.entries()) {
    console.log(`run ${k + 1}`);
    console.table(run);
  }
  console.log("main thread (ms):", JSON.stringify(out.trace));
  if (out.busy) console.log("background writing:", JSON.stringify(out.busy));
});
