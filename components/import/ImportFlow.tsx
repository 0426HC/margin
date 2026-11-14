"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Stage } from "@/components/cinematic/Stage";
import { useReducedSafe } from "@/components/cinematic/useReducedSafe";
import { Surface } from "@/components/ui/Surface";
import { fileKindOf, KIND_LABEL, unsupportedMessage } from "@/lib/import/kinds";
import { folderOf, stripCommonRoot } from "@/lib/import/paths";
import { folderName, type PickedFile } from "@/lib/import/pick-files";
import type { FileRow } from "@/lib/projects/types";
import { FolderDrop } from "./FolderDrop";
import { LibrarianDesk, type DeskPhase } from "./LibrarianDesk";

type State = "waiting" | "reading" | "done" | "failed";
interface Row extends PickedFile {
  key: string;
  state: State;
  note?: string;
  detail?: string;
}

const baseName = (p: string) => p.split("/").pop() ?? p;
const LOST = "Margin lost the connection while reading this file. Check that the app is still running, then add the folder again.";
const CONCURRENT = 2;

function Glyph({ state }: { state: State }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.4, "aria-hidden": true, className: "m-glyph" } as const;
  if (state === "waiting") return <svg {...common}><circle cx="7" cy="7" r="5.5" strokeDasharray="2.2 2.2" /></svg>;
  if (state === "reading") return <svg {...common}><circle cx="7" cy="7" r="5.5" /><path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" /></svg>;
  if (state === "done") return <svg {...common}><circle cx="7" cy="7" r="5.5" /><path d="M4.4 7.2l1.9 1.9 3.3-3.8" /></svg>;
  return <svg {...common}><circle cx="7" cy="7" r="5.5" /><path d="M4.9 4.9l4.2 4.2M9.1 4.9L4.9 9.1" /></svg>;
}

const STATUS_WORD: Record<State, string> = { waiting: "Waiting", reading: "Reading", done: "Read", failed: "Couldn't read" };

function detailOf(row: FileRow): string {
  if (row.pageKind === "slide") return `${row.pageCount} slide${row.pageCount === 1 ? "" : "s"}`;
  if (row.pageKind === "page") return `${row.pageCount} page${row.pageCount === 1 ? "" : "s"}`;
  return "";
}

export function ImportFlow() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [over, setOver] = useState(false);
  const reduced = useReducedSafe();

  const patch = (key: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function start(picked: PickedFile[]) {
    if (!picked.length) {
      setError("No files found there. Pick a folder that holds PDF, Word, PowerPoint, text or Markdown files.");
      return;
    }
    setError(null);
    const projectName = name.trim() || folderName(picked) || "Untitled course";
    setName(projectName);
    const initial: Row[] = picked.map((p, i) =>
      fileKindOf(p.file.name)
        ? { ...p, key: `${i}:${p.relPath}`, state: "waiting" }
        : { ...p, key: `${i}:${p.relPath}`, state: "failed", note: unsupportedMessage(p.file.name) },
    );
    setRows(initial);

    const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: projectName }) }).catch(() => null);
    if (!res?.ok) {
      setRows([]);
      setError("Margin couldn't start the project. Check that the app is still running and its data folder is writable, then try again.");
      return;
    }
    const { id } = (await res.json()) as { id: string };
    setProject({ id, name: projectName });

    const queue = initial.filter((r) => r.state === "waiting");
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const row = queue[next++];
        patch(row.key, { state: "reading" });
        try {
          const body = new FormData();
          body.append("file", row.file);
          body.append("relPath", row.relPath);
          const r = await fetch(`/api/projects/${id}/files`, { method: "POST", body });
          const data = (await r.json()) as FileRow;
          patch(row.key, data.status === "done" ? { state: "done", detail: detailOf(data) } : { state: "failed", note: data.error ?? LOST });
        } catch {
          patch(row.key, { state: "failed", note: LOST });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENT }, worker));
  }

  async function review() {
    if (!project) return;
    setBuilding(true);
    setError(null);
    const r = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" }).catch(() => null);
    if (!r?.ok) {
      setBuilding(false);
      setError("Margin couldn't open the review of these files. Check that the app is still running, then try again.");
      return;
    }
    router.push(`/p/${project.id}/import`);
  }

  function reset() {
    setProject(null);
    setRows([]);
    setName("");
    setError(null);
  }

  const shown = stripCommonRoot(rows.map((r) => r.relPath));
  const settled = rows.length > 0 && rows.every((r) => r.state === "done" || r.state === "failed");
  const done = rows.filter((r) => r.state === "done").length;
  const finished = rows.filter((r) => r.state === "done" || r.state === "failed").length;

  const phase: DeskPhase = over ? "over" : !rows.length ? "idle" : !settled ? "reading" : done ? "done" : "stuck";
  const current = rows.find((r) => r.state === "reading");
  const failed = finished - done;
  const title = project ? project.name : "New project";

  return (
    <Stage seed="margin:new" count={3} at={rows.length ? (2 * finished) / rows.length : 0} course={project ? "New project" : undefined}>
      <main className="st-main">
        <section className="st-new">
          <div>
            <h1 className="st-title st-new-title">{title}</h1>
            <p className="st-new-lede st-fade" style={{ animationDelay: reduced ? "0ms" : "500ms" }}>
              {project
                ? "Each file is read once, here on your computer. Then you check how Margin grouped them into units, and Margin proposes Part A, Part B and the layers inside each."
                : "Bring in a course folder. Margin reads the files, then proposes Part A and Part B and the layers inside each, for you to approve."}
            </p>

            {!project && (
              <div className="st-new-form st-fade" style={{ animationDelay: reduced ? "0ms" : "750ms" }}>
                <Input label="Project name" hint="Leave it blank to use the folder's name." value={name} onChange={(e) => setName(e.target.value)} placeholder="POL101: Political theory" />
                <FolderDrop onPick={start} onOver={setOver} />
                <ol className="st-flow" aria-label="What happens next">
                  <li>
                    <span>
                      <b>Margin reads the files.</b> Nothing leaves this computer while it does.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>It proposes Part A, Part B and their layers.</b> Each layer is one topic with one big question.
                    </span>
                  </li>
                  <li>
                    <span>
                      <b>You approve the breakdown.</b> Nothing is written until you do.
                    </span>
                  </li>
                </ol>
              </div>
            )}
          </div>
          <LibrarianDesk phase={phase} read={done} failed={failed} total={rows.length} current={current ? baseName(current.relPath) : undefined} />
        </section>

        {rows.length > 0 && (
          <Surface kind="paper" raised className="st-files px-8 py-6">
            <div className="flex items-baseline justify-between gap-4 pb-3">
              <h2 className="t-h3">Files</h2>
              <p className="t-label text-ink-muted" role="status" aria-live="polite">
                {finished} of {rows.length} read
              </p>
            </div>
            <ul className="m-0 list-none p-0">
              {rows.map((r, i) => (
                <li key={r.key} className="m-file-row" data-state={r.state}>
                  <Glyph state={r.state} />
                  <div>
                    <div className="m-file-name">{baseName(r.relPath)}</div>
                    {folderOf(shown[i]) && <div className="m-file-path">{folderOf(shown[i])}</div>}
                  </div>
                  <div className="m-file-status">
                    {fileKindOf(r.file.name) && <span>{KIND_LABEL[fileKindOf(r.file.name)!]} · </span>}
                    {STATUS_WORD[r.state]}
                    {r.state === "done" && r.detail ? ` · ${r.detail}` : ""}
                  </div>
                  {r.note && <p className="m-file-note">{r.note}</p>}
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {error && (
          <p className="m-field-error mt-4 max-w-[60ch]" role="alert">
            {error}
          </p>
        )}

        {settled && (
          <div className="st-after">
            {done > 0 ? (
              <>
                <Button variant="primary" size="lg" onClick={review} disabled={building}>
                  {building ? "Opening the review" : "Review units"}
                </Button>
                <p className="t-ui">
                  {done} of {rows.length} files read{done < rows.length ? `. The ${rows.length - done} that couldn't be read will be left out.` : "."} Next you check the units, then Margin proposes the layers.
                </p>
              </>
            ) : (
              <>
                <Button variant="primary" size="lg" onClick={reset}>
                  Start over
                </Button>
                <p className="t-ui">None of these files could be read. Fix them using the notes above, or choose another folder.</p>
              </>
            )}
          </div>
        )}
      </main>
    </Stage>
  );
}
