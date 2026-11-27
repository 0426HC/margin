/**
 * Builds demo/seed.json: imports the public-domain sample course, proposes and approves its layers with the REAL Claude Code
 * engine, reads every course file into the course brain, writes every layer and each week's Lecture tab, and exports the result. Run once: npm run demo:build  (it uses your Claude plan, a few minutes).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "margin-demo-build-"));
process.env.MARGIN_DATA_DIR = dataDir;

async function main() {
  const { openDb } = await import("../lib/db/client");
  const { ClaudeCodeEngine } = await import("../lib/ai/claude-code-engine");
  const { addFile, analyzeProject, createProject } = await import("../lib/projects/service");
  const { approvePlan, getStructure, proposeStructure, writeLayerContent } = await import("../lib/layers/service");
  const { exportDemoSeed } = await import("../lib/demo/seed");
  const { readIntoBrain } = await import("../lib/brain/read");
  const { writeWeekLecture } = await import("../lib/lecture/service");
  const { courseFiles } = await import("../lib/brain/store");

  const { db } = openDb(path.join(dataDir, "margin.db"));
  const root = path.join("demo", "sample-course", "POL101 Federalist Seminar");
  const id = createProject(db, { name: "The Federalist Papers", courseCode: "POL101" });

  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(root)) {
    await addFile(db, id, { name: path.basename(file), relPath: path.relative(root, file), bytes: new Uint8Array(fs.readFileSync(file)) });
  }
  const engine = new ClaudeCodeEngine();
  console.log("Sorting the files into weeks…");
  await analyzeProject(db, engine, id, (step) => console.log(`  ${step}`));

  console.log("Proposing the layers of each week…");
  await proposeStructure(db, engine, id);
  approvePlan(db, id);

  // the brain first, so every layer is written with its notes and its named things are checked as it is written
  const files = courseFiles(db, id);
  for (const [i, f] of files.entries()) {
    console.log(`Reading file ${i + 1} of ${files.length} into the course brain: ${f.name}`);
    await readIntoBrain(db, engine, f.id);
  }

  const layers = getStructure(db, id)!.weeks.flatMap((w) => w.layers);
  for (const [i, l] of layers.entries()) {
    console.log(`Writing layer ${i + 1} of ${layers.length}: ${l.title}`);
    await writeLayerContent(db, engine, l.id);
  }
  for (const w of getStructure(db, id)!.weeks.filter((x) => x.lecture)) {
    console.log(`Writing the Lecture tab of week ${w.week}`);
    await writeWeekLecture(db, engine, id, w.week);
  }

  const seed = exportDemoSeed(db, id);
  fs.writeFileSync(path.join("demo", "seed.json"), JSON.stringify(seed, null, 1) + "\n");
  console.log(`Wrote demo/seed.json: ${seed.layers.length} layers, ${seed.passages.length} passages, ${seed.brainNotes?.length ?? 0} brain notes.`);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
