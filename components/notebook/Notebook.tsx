"use client";

import { useState } from "react";
import type { GuidePart, GuideSlot } from "@/lib/layers/note-to-self";
import { NoteField, useQuickNote, useWriteUp, type SaveState } from "./QuickNote";

const SAVE_WORD: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved. Check the app is running." };

/**
 * One saved layer on the open book: my quick notes on the left page and my saved write-up on the right, starting at the same height.
 * Both are plain text I can click into and edit; editing the write-up changes the saved write-up everywhere. Nothing else is printed on the pages. The "Draft from my write-up" button appears only while the pointer (or focus) is in the notes area.
 */
function Row({ projectId, slot, write }: { projectId: string; slot: GuideSlot; write: NonNullable<GuideSlot["final"]> }) {
  const target = { type: slot.kind, id: slot.id } as const;
  const note = useQuickNote(projectId, target, slot.quick);
  const writeUp = useWriteUp(projectId, target, write.text);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/quick-notes/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType: target.type, targetId: target.id }) });
      const d = (await r.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!r.ok || !d?.text) setError(d?.error ?? "That didn't work. Try again.");
      else note.set(note.value.trim() ? `${note.value.trimEnd()}\n\n${d.text}` : d.text);
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      setDrafting(false);
    }
  };

  const status = error ?? SAVE_WORD[note.state];
  return (
    <article className="nb-row" data-version={write.version} aria-label={slot.title}>
      <div className="nb-l">
        <button type="button" className="nb-draft" onClick={() => void draft()} disabled={drafting}>
          {drafting ? "Drafting…" : "Draft from my write-up"}
        </button>
        <NoteField label={`Quick notes for ${slot.title}`} value={note.value} onChange={note.set} />
        <span className={error ? "nb-save nb-save-error" : "sr-only"} role={error ? "alert" : "status"}>
          {status}
        </span>
      </div>
      <div className="nb-r">
        <NoteField label={`Saved write-up of ${slot.title}, ${write.version === "own" ? "my own writing" : "refined version"}`} value={writeUp.value} onChange={writeUp.set} />
        <span className={writeUp.state === "error" ? "nb-save nb-save-error" : "sr-only"} role={writeUp.state === "error" ? "alert" : "status"}>
          {SAVE_WORD[writeUp.state]}
        </span>
      </div>
    </article>
  );
}

/** The whole notebook: only the layers (and Part syntheses) that were saved, in course order. One book, no headings, no dividers. */
export function Notebook({ projectId, parts }: { projectId: string; parts: GuidePart[] }) {
  return (
    <>
      {parts.map((p) => (
        <section key={p.key} className="nb-part" aria-label={p.title}>
          {[...p.layers, p.synthesis].map((s) => (s.final ? <Row key={s.id} projectId={projectId} slot={s} write={s.final} /> : null))}
        </section>
      ))}
    </>
  );
}
