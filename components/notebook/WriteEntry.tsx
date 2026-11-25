"use client";

import { useEffect, useRef, useState } from "react";
import type { GuideSlot } from "@/lib/layers/note-to-self";
import { NoteField, SAVE_WORD, useQuickNote, useWriteUp } from "./QuickNote";

export type Saved = GuideSlot & { final: NonNullable<GuideSlot["final"]> };

/** How long "Undo" is offered after Delete, before the write-up is really deleted. */
export const UNDO_MS = 6000;

/** Take a saved write-up (and that layer's quick notes) out of Note to Self, for good. The layer, its write-ups and its chat stay. */
export async function deleteWriteUp(projectId: string, slot: { kind: "layer" | "part"; id: string }, keepalive = false) {
  const r = await fetch(`/api/projects/${projectId}/write-up?targetType=${slot.kind}&targetId=${encodeURIComponent(slot.id)}`, { method: "DELETE", keepalive });
  return r.ok || r.status === 404;
}

/** A layer's own quick notes from before the left page became the condensed notes: kept, under its write-up, smaller, still editable. */
function LayerNotes({ projectId, slot }: { projectId: string; slot: Saved }) {
  const note = useQuickNote(projectId, { type: slot.kind, id: slot.id }, slot.quick);
  return (
    <div className="nb-quick">
      <NoteField label={`Quick notes for ${slot.title}`} value={note.value} onChange={note.set} minHeight={24} />
      <span className={note.state === "error" ? "nb-save nb-save-error" : "sr-only"} role={note.state === "error" ? "alert" : "status"}>
        {SAVE_WORD[note.state]}
      </span>
    </div>
  );
}

/**
 * One saved write-up, editable in place (it changes the saved write-up everywhere). Delete hides it at once and offers Undo for a few
 * seconds; only then is it deleted, so Undo needs nothing back from the server. Leaving the page deletes it at once.
 * Two looks: "plain" (lock in: the layer's name above the text) and "book" (the open notebook: only my own words on the paper, a quiet
 * Delete on hover or focus, and the layer's older quick notes under the write-up when it has any).
 */
export function WriteEntry({ projectId, slot, look, onRemoved }: { projectId: string; slot: Saved; look: "plain" | "book"; onRemoved: () => void }) {
  const book = look === "book";
  const target = { type: slot.kind, id: slot.id } as const;
  const writeUp = useWriteUp(projectId, target, slot.final.text);
  const version = slot.final.version === "own" ? "my own writing" : "refined version";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // the quick notes are shown only for a layer that had some when the page opened; emptying them keeps the field until the next visit
  const [hasNotes] = useState(() => book && slot.quick.trim() !== "");

  const commit = async (keepalive = false) => {
    timer.current = null;
    if (await deleteWriteUp(projectId, slot, keepalive)) onRemoved();
    else {
      setPending(false);
      setError("That didn't work. Try again.");
    }
  };
  // a delete still waiting when the page is left goes through
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const { kind, id } = slot;
  useEffect(() => {
    const leave = () => {
      if (!pendingRef.current || !timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void deleteWriteUp(projectId, { kind, id }, true);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [projectId, kind, id]);

  const del = () => {
    setError(null);
    setPending(true);
    timer.current = setTimeout(() => void commit(), UNDO_MS);
    requestAnimationFrame(() => undoRef.current?.focus());
  };
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(false);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  if (pending)
    return (
      <p className={book ? "nb-gone" : "lk-nts-gone"} role="status">
        <span>Deleted “{slot.title}”.</span>
        <button type="button" ref={undoRef} className={book ? "nb-undo" : "lk-nts-undo"} onClick={undo}>
          Undo
        </button>
      </p>
    );
  const deleteButton = (
    <button type="button" ref={deleteRef} className={book ? "nb-remove" : "lk-nts-delete"} onClick={del} aria-label={`Delete the write-up of “${slot.title}” from Note to Self`}>
      Delete
    </button>
  );
  return (
    <article className={book ? "nb-r nb-entry" : "lk-nts-entry"} data-version={slot.final.version} aria-label={`Write-up of ${slot.title}`}>
      {book ? (
        deleteButton
      ) : (
        <header className="lk-nts-label">
          <span>{slot.title}</span>
          {deleteButton}
        </header>
      )}
      <NoteField label={`Saved write-up of ${slot.title}, ${version}`} value={writeUp.value} onChange={writeUp.set} />
      <span className={writeUp.state === "error" || error ? "nb-save nb-save-error" : "sr-only"} role={writeUp.state === "error" || error ? "alert" : "status"}>
        {error ?? SAVE_WORD[writeUp.state]}
      </span>
      {hasNotes && <LayerNotes projectId={projectId} slot={slot} />}
    </article>
  );
}
