/**
 * Builds demo/seed.json: imports the public-domain sample course, proposes and approves its layers with the REAL Claude Code
 * engine, writes every layer, and exports the result. Run once: npm run demo:build  (it uses your Claude plan, a few minutes).
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
  const { approvePart, getStructure, proposeStructure, writeLayerContent } = await import("../lib/layers/service");
  const { exportDemoSeed } = await import("../lib/demo/seed");

  const { db } = openDb(path.join(dataDir, "margin.db"));
  const root = path.join("demo", "sample-course", "POL101 Federalist Seminar");
  const id = createProject(db, { name: "The Federalist Papers", courseCode: "POL101" });

  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(root)) {
    await addFile(db, id, { name: path.basename(file), relPath: path.relative(root, file), bytes: new Uint8Array(fs.readFileSync(file)) });
  }
  analyzeProject(db, id);

  const engine = new ClaudeCodeEngine();
  console.log("Proposing the Part split and the layers…");
  await proposeStructure(db, engine, id);
  approvePart(db, id, "A");
  approvePart(db, id, "B");

  const layers = getStructure(db, id)!.parts.flatMap((p) => p.layers);
  for (const [i, l] of layers.entries()) {
    console.log(`Writing layer ${i + 1} of ${layers.length}: ${l.title}`);
    await writeLayerContent(db, engine, l.id);
  }

  const seed = exportDemoSeed(db, id);
  fs.writeFileSync(path.join("demo", "seed.json"), JSON.stringify(seed, null, 1) + "\n");
  console.log(`Wrote demo/seed.json: ${seed.layers.length} layers, ${seed.passages.length} passages.`);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
