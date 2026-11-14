import { cannedEngine } from "@/lib/ai/canned";
import type { Db } from "@/lib/db/client";
import { approvePart, getStructure, proposeStructure } from "@/lib/layers/service";
import { addFile, analyzeProject, createProject } from "@/lib/projects/service";

const enc = (t: string) => new TextEncoder().encode(t);
let seed = 0;
const words = (n: number) => Array.from({ length: n }, () => `kw${++seed}q`).join(" ");
const paragraphs = (n: number) => Array.from({ length: n }, () => words(60)).join("\n\n");

/** A small four-week course, imported, split into Parts and layers by the canned engine, and approved. */
export async function makeApprovedProject(db: Db, name = "POL101 Politics") {
  const id = createProject(db, { name });
  const files: [string, string, string][] = [
    ["a.txt", "Week 1 - Foundations/a.txt", `FEDERALIST No. 1\n\nIntro\n\n${paragraphs(30)}\n\nFEDERALIST No. 2\n\nDangers\n\n${paragraphs(30)}`],
    ["b.txt", "Week 2 - Faction/b.txt", paragraphs(40)],
    ["c.txt", "Week 3 - Checks/c.txt", paragraphs(40)],
    ["d.txt", "Week 4 - Review/d.txt", paragraphs(40)],
  ];
  for (const [fileName, relPath, text] of files) await addFile(db, id, { name: fileName, relPath, bytes: enc(text) });
  analyzeProject(db, id);
  await proposeStructure(db, cannedEngine(), id);
  approvePart(db, id, "A");
  approvePart(db, id, "B");
  return { id, layers: () => getStructure(db, id)!.parts.flatMap((p) => p.layers) };
}
