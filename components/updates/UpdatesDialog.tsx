"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { fromInput, type PickedFile } from "@/lib/import/pick-files";
import { canRememberFolder, hashFile, pickFolder, rememberedFolder, rememberFolder, reopenFolder, splitReadable } from "@/lib/updates/client";
import type { Inspected, Labelled } from "@/lib/updates/service";
import type { FileType } from "@/lib/projects/file-kinds";
import { ProposalStep } from "./ProposalStep";
import { ReviewList } from "./ReviewList";
import type { CommitSummary, PendingModel, RemovedItem, ReviewItem, WeekRow } from "./types";
import { WeekSelect } from "./WeekSelect";

export type UpdatesMode = "folder" | "files";
type Step = "start" | "checking" | "week" | "review" | "applying" | "approve" | "done";

const noSubscribe = () => () => {};
const CONCURRENT = 2;
const err = async (r: Response, fallback: string) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback;
const LOST = "Margin lost the connection. Check that the app is still running, then try again.";

interface Compared {
  added: { name: string; relPath: string; hash: string }[];
  changed: { name: string; relPath: string; hash: string; storedId: string; type: FileType | null; week: number | null }[];
  removed: Omit<RemovedItem, "include" | "keep">[];
  unchanged: number;
  weeks: WeekRow[];
}

/** Run `work` over `list` two at a time, in order of arrival. */
async function pool<T>(list: T[], work: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENT, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        await work(list[i], i);
      }
    }),
  );
}

/**
 * Add files and Update from folder: one sheet with the steps. Choose files (or the course folder again), check what's new by fingerprint,
 * review the "What's new" list, approve, then approve any new layers. Nothing is written until the approval; saved write-ups are never changed.
 */
export function UpdatesDialog({ projectId, isDemo, mode, onClose }: { projectId: string; isDemo: boolean; mode: UpdatesMode | null; onClose: () => void }) {
  // mounted only while open, so every opening starts from a clean first step
  return mode ? <Sheet projectId={projectId} isDemo={isDemo} mode={mode} onClose={onClose} /> : null;
}

function Sheet({ projectId, isDemo, mode, onClose }: { projectId: string; isDemo: boolean; mode: UpdatesMode; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const host = useSyncExternalStore(
    noSubscribe,
    () => document.body,
    () => null,
  );
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const changedSomething = useRef(false);

  const [step, setStep] = useState<Step>("start");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [removed, setRemoved] = useState<RemovedItem[]>([]);
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [unchanged, setUnchanged] = useState(0);
  const [skippedKinds, setSkippedKinds] = useState(0);
  const [pickedWeek, setPickedWeek] = useState<number | null>(null); // the Add files dropdown: null is "Not sure, let Margin decide"
  const [remember, setRemember] = useState(true);
  const [remembered, setRemembered] = useState(false);
  const [pending, setPending] = useState<PendingModel | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [staged, setStaged] = useState<string[]>([]);
  const handle = useRef<Awaited<ReturnType<typeof rememberedFolder>>>(null);

  // look for new layers still waiting for approval, and for a remembered folder
  useEffect(() => {
    let gone = false;
    void fetch(`/api/projects/${projectId}/updates/pending`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: PendingModel | null) => {
        if (gone || !p) return;
        setPending(p);
        if (p.proposed.length) setStep("approve");
      })
      .catch(() => undefined);
    void rememberedFolder(projectId).then((h) => {
      if (gone) return;
      handle.current = h;
      setRemembered(!!h);
    });
    return () => {
      gone = true;
    };
  }, [projectId]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, [host]);

  const close = useCallback(() => {
    if (busy || step === "applying" || step === "checking") return;
    onClose();
    if (changedSomething.current) router.refresh();
  }, [busy, step, onClose, router]);

  // ---- checking: fingerprint, compare, look at each new or changed file
  const check = useCallback(
    async (picked: PickedFile[], asFolder: boolean) => {
      const { readable, skipped } = splitReadable(picked);
      if (!readable.length) {
        setError("No files Margin can read there. Pick PDF, Word, PowerPoint, text or Markdown files.");
        return;
      }
      setError(null);
      setStep("checking");
      setSkippedKinds(skipped);
      try {
        const hashes: string[] = [];
        setProgress({ done: 0, total: readable.length, what: "Fingerprinting files" });
        await pool(readable, async (f, i) => {
          hashes[i] = await hashFile(f.file);
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        });
        const r = await fetch(`/api/projects/${projectId}/updates/compare`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: readable.map((f, i) => ({ name: f.file.name, relPath: f.relPath, hash: hashes[i] })) }),
        });
        if (!r.ok) throw new Error(await err(r, "Margin couldn't compare these files."));
        const c = (await r.json()) as Compared;
        setWeeks(c.weeks);
        setUnchanged(c.unchanged);
        const byPath = new Map(readable.map((f, i) => [f.relPath, { ...f, hash: hashes[i] }]));
        const todo = [...c.added.map((a) => ({ ...a, group: "new" as const })), ...c.changed.map((a) => ({ ...a, group: "changed" as const }))];
        setProgress({ done: 0, total: todo.length, what: "Reading the new and changed files" });
        const out: ReviewItem[] = [];
        const facts = new Map<string, Extract<Inspected, { ok: true }>["facts"]>();
        await pool(todo, async (t, i) => {
          const f = byPath.get(t.relPath)!;
          const form = new FormData();
          form.append("file", f.file);
          form.append("relPath", f.relPath);
          const ir = await fetch(`/api/projects/${projectId}/updates/inspect`, { method: "POST", body: form });
          const info = (ir.ok ? await ir.json() : { ok: false, name: f.file.name, error: await err(ir, "Margin couldn't read this file.") }) as Inspected;
          const prior = t.group === "changed" ? (t as Compared["changed"][number]) : null;
          const base = { key: `${i}:${f.relPath}`, file: f.file, relPath: f.relPath, name: f.file.name, hash: f.hash, group: t.group, storedId: prior?.storedId };
          if (!info.ok) out[i] = { ...base, include: false, type: null, week: null, check: false, reason: "", error: info.error };
          // a changed file is a new version of one the course holds: it keeps that file's week and type
          else if (prior?.type) out[i] = { ...base, include: true, type: prior.type, week: prior.week, check: false, reason: "A new version of a file the course already has, so it keeps that file's week and type." };
          else {
            facts.set(f.relPath, info.facts);
            out[i] = { ...base, include: true, type: null, week: null, check: false, reason: "" };
          }
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        });
        if (facts.size) {
          setProgress({ done: 0, total: 0, what: `Claude is reading the syllabus and labelling ${facts.size === 1 ? "the new file" : `${facts.size} new files`}. This takes a minute or so.` });
          const lr = await fetch(`/api/projects/${projectId}/updates/label`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files: [...facts].map(([relPath, f]) => ({ relPath, facts: f })) }),
          });
          const labelled = (lr.ok ? await lr.json() : { ok: false, message: await err(lr, "Margin couldn't ask Claude about the new files.") }) as Labelled;
          for (const it of out) {
            if (!it || !facts.has(it.relPath)) continue;
            const l = labelled.ok ? labelled.labels[it.relPath] : undefined;
            if (l) Object.assign(it, { type: l.type, week: l.week, check: l.check, reason: l.reason });
            else it.reason = labelled.ok ? "Claude didn't label this file." : `Claude couldn't label the new files: ${labelled.message}`;
          }
        }
        setItems(out);
        setRemoved(asFolder ? c.removed.map((x) => ({ ...x, include: true, keep: true })) : []);
        if (!asFolder) {
          const all = new Set(out.filter((o) => !o.error && o.type !== "exam" && o.type !== "syllabus").map((o) => o.week));
          setPickedWeek(all.size === 1 ? ([...all][0] ?? null) : null);
          setStep("week");
        } else setStep("review");
      } catch (e) {
        setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
        setStep("start");
      } finally {
        setProgress(null);
      }
    },
    [projectId],
  );

  const chooseFolder = async () => {
    if (canRememberFolder()) {
      const r = await pickFolder();
      if (!r) return;
      if (remember) {
        await rememberFolder(projectId, r.handle);
        handle.current = r.handle;
        setRemembered(true);
      }
      await check(r.files, true);
    } else folderInput.current?.click();
  };
  const checkRemembered = async () => {
    if (!handle.current) return;
    const files = await reopenFolder(handle.current);
    if (!files) {
      setError("Margin can't open that folder any more. Choose the course folder again.");
      setRemembered(false);
      return;
    }
    await check(files, true);
  };

  const patchItem = (key: string, p: Partial<ReviewItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const patchRemoved = (rid: string, p: Partial<RemovedItem>) => setRemoved((list) => list.map((r) => (r.id === rid ? { ...r, ...p } : r)));
  const setAllWeeks = (w: number | null) => {
    setPickedWeek(w);
    // "Not sure" lets each file keep Margin's own suggestion; a week the student picks applies to all of them
    if (w !== null) setItems((list) => list.map((i) => (i.error || i.type === "exam" || i.type === "syllabus" ? i : { ...i, week: w, check: false, reason: "You chose this week." })));
  };

  // ---- applying: store each approved file, then write them into the course and place them
  const apply = async () => {
    const chosen = items.filter((i) => i.include && !i.error);
    const acts = removed.filter((r) => r.include);
    setStep("applying");
    setError(null);
    setBusy(true);
    try {
      const ids: { fileId: string; replaces?: string }[] = [];
      setProgress({ done: 0, total: chosen.length, what: "Reading the files into your course" });
      await pool(chosen, async (it) => {
        const form = new FormData();
        form.append("file", it.file);
        form.append("relPath", it.relPath);
        if (it.type) form.append("type", it.type);
        if (it.week) form.append("week", String(it.week));
        form.append("reason", it.reason);
        if (it.check) form.append("check", "1");
        const r = await fetch(`/api/projects/${projectId}/updates/stage`, { method: "POST", body: form });
        if (!r.ok) throw new Error(await err(r, "Margin couldn't store a file."));
        const row = (await r.json()) as { id: string; status: string; error: string | null };
        if (row.status !== "done") throw new Error(`${it.name}: ${row.error ?? "it couldn't be read."}`);
        ids.push({ fileId: row.id, replaces: it.storedId });
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      });
      setProgress(null);
      setStaged(ids.map((i) => i.fileId));
      const r = await fetch(`/api/projects/${projectId}/updates/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ staged: ids, removals: acts.map((a) => ({ fileId: a.id, keep: a.keep })) }),
      });
      if (!r.ok) throw new Error(await err(r, "Margin couldn't add the files."));
      const s = (await r.json()) as CommitSummary;
      changedSomething.current = true;
      setSummary(s);
      setPending(s.pending);
      setStep(s.pending.proposed.length ? "approve" : "done");
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
      setStep("review");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const approve = async (decisions: Parameters<React.ComponentProps<typeof ProposalStep>["onApprove"]>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/updates/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions }),
      });
      if (!r.ok) throw new Error(await err(r, "Margin couldn't save your choices."));
      const d = (await r.json()) as { pending: PendingModel };
      changedSomething.current = true;
      setPending(d.pending);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
    } finally {
      setBusy(false);
    }
  };

  const retryPlacing = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/updates/pending`, { method: "POST" });
      if (!r.ok) throw new Error(await err(r, "Margin couldn't place the new material."));
      const d = (await r.json()) as { placed: CommitSummary["placed"]; pending: PendingModel };
      changedSomething.current = true;
      setSummary((s) =>
        s
          ? { ...s, placed: d.placed, pending: d.pending }
          : {
              committed: { added: [], replaced: [], examSheets: [], removed: 0, kept: 0, emptiedLayers: [], deletedLayers: [] },
              placed: d.placed,
              pending: d.pending,
            },
      );
      setPending(d.pending);
      setStep(d.pending.proposed.length ? "approve" : "done");
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : LOST);
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;
  const folder = mode === "folder";
  const title =
    step === "approve"
      ? "New material is in"
      : step === "done"
        ? "Your course is up to date"
        : step === "review" || step === "applying"
          ? "What’s new"
          : folder
            ? "Update from folder"
            : "Add files";
  const included = items.filter((i) => i.include && !i.error).length + removed.filter((r) => r.include).length;
  const c = summary?.committed;

  return createPortal(
    <dialog
      ref={ref}
      className="m-dialog m-paper upd"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const els = [
          ...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled):not([hidden])"),
        ].filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const at = els.indexOf(document.activeElement as HTMLElement);
        if ((e.shiftKey && at <= 0) || (!e.shiftKey && at === els.length - 1)) {
          e.preventDefault();
          (e.shiftKey ? els[els.length - 1] : els[0]).focus();
        }
      }}
    >
      <div className="m-dialog-body">
        <h2 id={`${id}-title`} className="t-h3">
          {title}
        </h2>

        {step === "start" && (
          <>
            <p className="upd-lede">
              {folder
                ? "Choose the course folder again. Margin fingerprints every file and finds what is new, changed or removed. Files that haven’t changed are skipped, and nothing is written until you approve."
                : "Choose one or more files. Margin suggests which week each belongs to and whether it is a lecture or a reading; you check the list before anything is added."}
            </p>
            <div className="upd-row-actions">
              {folder ? (
                <>
                  {remembered && (
                    <Button variant="accent" size="lg" onClick={() => void checkRemembered()}>
                      Check for updates
                    </Button>
                  )}
                  <Button variant={remembered ? "secondary" : "accent"} size={remembered ? "md" : "lg"} onClick={() => void chooseFolder()}>
                    {remembered ? "Choose a different folder" : "Choose the course folder"}
                  </Button>
                </>
              ) : (
                <Button variant="accent" size="lg" onClick={() => filesInput.current?.click()}>
                  Choose files
                </Button>
              )}
            </div>
            {folder && canRememberFolder() && !remembered && (
              <label className="upd-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember this folder so I can check for updates without choosing it again
              </label>
            )}
            {folder && remembered && (
              <p className="upd-lede upd-muted">Margin remembers your folder in this browser. It only reads it when you click “Check for updates”.</p>
            )}
            {isDemo && <p className="upd-lede upd-muted">This is the demo, which is read-only. You can see what Margin finds, but nothing is added.</p>}
            {error && (
              <p className="m-field-error" role="alert">
                {error}
              </p>
            )}
            <div className="m-dialog-actions">
              <Button onClick={close}>Cancel</Button>
            </div>
          </>
        )}

        {step === "checking" && (
          <>
            <p className="upd-lede" role="status">
              {progress ? `${progress.what}: ${progress.done} of ${progress.total}` : "Checking…"}
            </p>
            <div className="upd-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${progress && progress.total ? progress.done / progress.total : 0})` }} />
            </div>
          </>
        )}

        {step === "week" && (
          <>
            <ul className="upd-chosen" aria-label="The files you chose">
              {items.map((i) => (
                <li key={i.key}>{i.name}</li>
              ))}
            </ul>
            {items.length === 0 && <p className="upd-lede">Every file you chose is already in the course, so there is nothing to add.</p>}
            {items.length > 0 && (
              <div className="upd-field">
                <label htmlFor={`${id}-week`}>Which week are they for?</label>
                <WeekSelect
                  id={`${id}-week`}
                  weeks={weeks}
                  value={pickedWeek}
                  onChange={setAllWeeks}
                  label="Which week are they for?"
                  undecided="Not sure, let Margin decide"
                />
                <p className="upd-lede upd-muted">
                  {pickedWeek === null
                    ? "Margin decides for each file from its name, the syllabus and what it says, and shows you its choice next."
                    : "Margin’s suggestion is selected. You can change the week of any file on the next screen."}
                </p>
              </div>
            )}
            <div className="m-dialog-actions">
              <Button onClick={close}>Cancel</Button>
              <Button variant="accent" disabled={!items.length && !unchanged} onClick={() => setStep("review")}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <ReviewList
              items={items}
              removed={removed}
              weeks={weeks}
              unchanged={unchanged}
              skippedKinds={skippedKinds}
              onItem={patchItem}
              onRemoved={patchRemoved}
            />
            {error && (
              <p className="m-field-error" role="alert">
                {error}
              </p>
            )}
            {isDemo && <p className="upd-lede upd-muted">The demo is read-only, so nothing here can be added to it.</p>}
            <div className="m-dialog-actions">
              <Button onClick={close}>Cancel</Button>
              <Button variant="accent" disabled={isDemo || included === 0} onClick={() => void apply()}>
                {included === 0 ? "Nothing selected" : `Add ${included} ${included === 1 ? "change" : "changes"} to the course`}
              </Button>
            </div>
          </>
        )}

        {step === "applying" && (
          <>
            <p className="upd-lede" role="status">
              {progress
                ? `${progress.what}: ${progress.done} of ${progress.total}`
                : staged.length
                  ? "Putting the new material into your layers. This can take a minute."
                  : "Working…"}
            </p>
            <div className="upd-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${progress && progress.total ? progress.done / progress.total : 1})` }} />
            </div>
          </>
        )}

        {step === "approve" && pending && (
          <ProposalStep
            pending={pending}
            summary={summary}
            busy={busy}
            error={error}
            onApprove={(d) => void approve(d)}
            onLater={() => {
              onClose();
              if (changedSomething.current) router.refresh();
            }}
          />
        )}

        {step === "done" && (
          <>
            <div className="upd-after">
              {c && (
                <ul className="upd-plain">
                  {c.added.length > 0 && (
                    <li>
                      {c.added.length} {c.added.length === 1 ? "file" : "files"} added or replaced.
                    </li>
                  )}
                  {summary!.placed.toLayers.map((t) => (
                    <li key={t.layerId}>
                      {t.title}
                      <small>{t.files.join(", ")} · now shows “New material since you saved”</small>
                    </li>
                  ))}
                  {c.examSheets.map((x) => (
                    <li key={x.id}>
                      {x.name}
                      <small>Kept as the {x.kind === "midterm" ? "midterm" : x.kind === "final" ? "final" : "exam"} sheet. Margin doesn’t use it yet.</small>
                    </li>
                  ))}
                  {c.removed > 0 && (
                    <li>
                      {c.removed} {c.removed === 1 ? "file" : "files"} removed from the layers.
                    </li>
                  )}
                  {c.kept > 0 && (
                    <li>
                      {c.kept} {c.kept === 1 ? "file" : "files"} left the folder; its text stays in your course.
                    </li>
                  )}
                  {c.emptiedLayers.length > 0 && (
                    <li>
                      {c.emptiedLayers.length} {c.emptiedLayers.length === 1 ? "layer has" : "layers have"} no text left.{" "}
                      {c.emptiedLayers.length === 1 ? "It stays" : "They stay"} because you wrote in {c.emptiedLayers.length === 1 ? "it" : "them"}.
                    </li>
                  )}
                  {c.deletedLayers.length > 0 && (
                    <li>
                      {c.deletedLayers.length} empty {c.deletedLayers.length === 1 ? "layer was" : "layers were"} removed.
                    </li>
                  )}
                </ul>
              )}
              {summary?.placed.fellBack && (
                <p className="upd-lede">
                  Margin couldn’t get a valid plan from Claude for the new material, so it was placed by week instead. Check where it went.
                </p>
              )}
              {pending && pending.unplaced > 0 && (
                <>
                  <p className="upd-lede">
                    {pending.unplaced} new {pending.unplaced === 1 ? "passage isn’t" : "passages aren’t"} in a layer yet.
                  </p>
                  <div className="upd-row-actions">
                    <Button variant="accent" onClick={() => void retryPlacing()} disabled={busy}>
                      {busy ? "Placing…" : "Place them now"}
                    </Button>
                  </div>
                </>
              )}
              {!c && <p className="upd-lede">Your layers are as you left them.</p>}
              <p className="upd-lede upd-muted">Your saved write-ups were not changed.</p>
              {error && (
                <p className="m-field-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="m-dialog-actions">
              <Button variant="accent" onClick={close}>
                Done
              </Button>
            </div>
          </>
        )}

        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          data-testid="updates-files-input"
          aria-label="Choose files"
          accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
          onChange={(e) => {
            const picked = fromInput(e.target.files);
            e.target.value = "";
            if (picked.length) void check(picked, false);
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          data-testid="updates-folder-input"
          aria-label="Choose the course folder"
          {...({ webkitdirectory: "" } as object)}
          onChange={(e) => {
            const picked = fromInput(e.target.files);
            e.target.value = "";
            if (picked.length) void check(picked, true);
          }}
        />
      </div>
    </dialog>,
    host,
  );
}
