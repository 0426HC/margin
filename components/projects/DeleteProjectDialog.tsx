"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { forgetFolder } from "@/lib/updates/client";

/**
 * Deleting a project, on its card and in its overview. It names the project and says what goes. On confirm the project and all of its
 * data are removed on the server; `onDeleted` then takes the student back to Your projects. A project that is already gone counts as deleted.
 */
export function DeleteProjectDialog({ project, onClose, onDeleted }: { project: { id: string; name: string; isDemo: boolean; draft?: boolean } | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // keep the last project while the dialog closes, so its text does not flicker
  const [shown, setShown] = useState(project);
  if (project && project !== shown) setShown(project);

  const deleteIt = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) {
        setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Margin couldn't delete the project. Try again.");
        return;
      }
      void forgetFolder(project.id); // the browser's remembered handle to the course folder goes with the project
      onDeleted();
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={project !== null}
      title={shown?.draft ? `Discard “${shown?.name ?? ""}”?` : `Delete “${shown?.name ?? ""}”?`}
      confirmLabel={shown?.draft ? "Discard draft" : "Delete project"}
      busyLabel={shown?.draft ? "Discarding…" : undefined}
      busy={busy}
      error={error}
      onConfirm={() => void deleteIt()}
      onCancel={() => {
        setError(null);
        onClose();
      }}
    >
      {shown?.draft ? (
        <p>Setting up this course was never finished. Discarding removes the files Margin read and anything planned so far. It cannot be undone.</p>
      ) : (
        <p>This permanently removes its files, layers, write-ups, Note to Self, chats, notepad and sources from this computer. It cannot be undone.</p>
      )}
      {shown?.isDemo && <p>The demo course can be opened again from Your projects, as a fresh copy without your work.</p>}
    </ConfirmDialog>
  );
}
