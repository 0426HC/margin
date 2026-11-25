import { cannedEngine } from "@/lib/ai/canned";
import type { Db } from "@/lib/db/client";
import { approvePlan, getStructure, proposeStructure } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `kw${++seed}q`).join(" ");
const paragraphs = (n: number) => Array.from({ length: n }, () => words(60)).join("\n\n");

/** A small four-week course (each week under 1,500 words, so one layer each), imported, split into weeks and layers by the canned engine, and approved. */
export async function makeApprovedProject(db: Db, name = "POL101 Politics") {
  const id = createProject(db, { name });
  const files: [string, string, string][] = [
    // each week under 1,500 words, so each is one layer
    ["a.txt", "Week 1 - Foundations/a.txt", `FEDERALIST No. 1\n\nIntro\n\n${paragraphs(11)}\n\nFEDERALIST No. 2\n\nDangers\n\n${paragraphs(11)}`],
    ["b.txt", "Week 2 - Faction/b.txt", paragraphs(20)],
    ["c.txt", "Week 3 - Checks/c.txt", paragraphs(20)],
    ["d.txt", "Week 4 - Review/d.txt", paragraphs(20)],
  ];
  for (const [fileName, relPath, text] of files) await addFile(db, id, { name: fileName, relPath, bytes: enc(text) });
  await analyzeProject(db, cannedEngine(), id);
  await proposeStructure(db, cannedEngine(), id);
  approvePlan(db, id); // "Looks good"
  return { id, layers: () => getStructure(db, id)!.weeks.flatMap((w) => w.layers) };
}
