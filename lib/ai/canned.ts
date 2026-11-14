import type { AiRequest } from "./engine";
import { EngineError } from "./errors";
import { FakeEngine } from "./fake-engine";

/** Schema-valid answers for the layer flow, built from what the prompt contains. Used by MARGIN_ENGINE=fake, so tests and e2e run offline. */
export function cannedJson(req: AiRequest): unknown {
  if (req.system.includes("two halves")) {
    const units = [...req.prompt.matchAll(/^(\d+)\. /gm)].length;
    return { firstUnitOfPartB: Math.max(2, Math.floor(units / 2) + 1), reason: "The halves are close to equal in material." };
  }
  if (req.system.includes("into LAYERS, by topic")) {
    const lines = [...req.prompt.matchAll(/^#(\d+) \| ([^|]*) \|/gm)];
    const count = lines.length;
    const k = Math.min(4, count);
    const size = Math.ceil(count / k);
    const layers = [];
    for (let i = 0; i < k && i * size < count; i++) {
      const from = i * size + 1;
      const to = Math.min(count, (i + 1) * size);
      const unit = lines[from - 1][2].trim();
      layers.push({ title: `${unit}: topic ${i + 1}`.slice(0, 80), bigQuestion: `What does ${unit} establish in topic ${i + 1}?`, buildsOn: i === 0 ? "" : "Builds on the topic before it.", ranges: [{ from, to }] });
    }
    return { layers };
  }
  if (req.system.includes("You choose the source passages")) {
    const ns = [...req.prompt.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
    return { passages: ns.slice(0, 3) };
  }
  if (req.system.includes("You are the Librarian")) {
    // Two topics from the first four passages, so grouping and de-duplication can be seen offline.
    const ns = [...req.prompt.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
    const topics = [];
    if (ns.length) topics.push({ topic: "Main idea", passages: ns.slice(0, 2) });
    if (ns.length > 2) topics.push({ topic: "Supporting detail", passages: ns.slice(2, 4) });
    return { topics };
  }
  if (req.system.includes('write the "Explained" tab')) {
    const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0] ?? "";
    return {
      blocks: [
        { type: "heading", text: "The basics first" },
        { type: "paragraph", text: `This is a canned explanation of the layer, written without a model. ${cite}` },
        { type: "bullets", items: [`First point, taken from the passages. ${cite}`, `Second point, taken from the passages. ${cite}`] },
      ],
      soWhat: "This layer connects to the bigger argument of the course and to the layers around it.",
    };
  }
  if (req.system.includes("You review a student's write-back")) {
    // First attempt: one fix. A revision (the prompt carries their earlier attempt) is approved.
    const writing = req.prompt.split(/## The student's (?:write-back|synthesis)\n/)[1]?.trim() ?? "";
    const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0] ?? "";
    const revised = req.prompt.includes("## Their earlier attempt");
    return {
      fixes: revised ? [] : [{ kind: "missing", text: `Say which term the passage defines first, and in the passage's own words. ${cite}`.trim() }],
      cleanedUp: writing || "Nothing was written.",
      soWhat: req.system.includes("synthesis of a whole Part") ? "Together these layers make one argument about the Part." : "This layer is one step in the course's larger argument.",
      verdict: revised ? "approved" : "needs_work",
    };
  }
  throw new EngineError("FakeEngineEmpty", "The fake engine has no canned answer for this call.");
}

/** Streamed text. The professor answers from the first passage it was sent and cites it; everything else gets the plain canned line. */
export function cannedText(req: AiRequest): string {
  if (req.system.includes("You are the student's professor") || req.system.includes("study partner for their Note to Self")) {
    const cite = req.prompt.match(/\[[^\]\n]+, p\. \d+\]/)?.[0];
    return cite ? `Here is what your files say, in plain words. ${cite}` : "Your files don't cover that. Ask about a topic from the course.";
  }
  if (req.system.includes("quick study notes")) {
    const writeup = req.prompt.split("## The student's write-up\n")[1] ?? "";
    const lines = writeup.split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
    return (lines.length ? lines : ["Nothing to note."]).map((l) => `→ ${l}`).join("\n");
  }
  return "This is a canned reply.";
}

export const cannedEngine = (delayMs = Number(process.env.MARGIN_FAKE_DELAY_MS ?? 0)) => new FakeEngine({ json: cannedJson, text: cannedText, delayMs });
