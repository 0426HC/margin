"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { overlayOpen, typing } from "@/components/shell/BackToCourse";
import { forgetFolder } from "@/lib/updates/client";

/**
 * The way out of every import step: a back link to Your projects and, once a draft project exists, Cancel. Cancel stops the work at once
 * (`onStop` aborts uploads and any AI call), then asks whether to discard the draft or keep it on Your projects to finish later.
 * Esc works as back, except while typing or while a dialog is open.
 */
export function SetupBar({ projectId, projectName, onStop }: { projectId: string | null; projectName?: string; onStop?: () => void }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // the same rule as BackToCourse: decided before other handlers run, acted on only if none of them claimed the key
    const mine = new WeakSet<KeyboardEvent>();
    const first = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing && !asking && !typing(e.target) && !overlayOpen()) mine.add(e);
    };
    const last = (e: KeyboardEvent) => {
      if (!mine.has(e) || e.defaultPrevented) return;
      onStop?.();
      router.push("/");
    };
    window.addEventListener("keydown", first, true);
    window.addEventListener("keydown", last);
    return () => {
      window.removeEventListener("keydown", first, true);
      window.removeEventListener("keydown", last);
    };
  }, [asking, onStop, router]);

  const cancel = () => {
    onStop?.();
    setError(null);
    setAsking(true);
  };

  const discard = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r || (!r.ok && r.status !== 404)) {
      setError("Margin couldn't discard the draft. Check that the app is still running, then try again.");
      return;
    }
    void forgetFolder(projectId);
    setAsking(false);
    router.push("/");
    router.refresh();
  };

  return (
    <div className="m-setup-bar">
      <Link href="/" className="m-back" aria-label="Back to Your projects" aria-keyshortcuts="Escape" onClick={() => onStop?.()}>
        <span className="m-back-arrow" aria-hidden="true">
          ←
        </span>
        <span className="m-back-name">Your projects</span>
      </Link>
      {projectId && (
        <Button variant="quiet" onClick={cancel}>
          Cancel
        </Button>
      )}
      <ConfirmDialog
        open={asking}
        title={projectName ? `Discard “${projectName}”?` : "Discard this draft?"}
        confirmLabel="Discard draft"
        cancelLabel="Keep as draft"
        busyLabel="Discarding…"
        busy={busy}
        error={error}
        onConfirm={() => void discard()}
        onCancel={() => {
          setAsking(false);
          router.push("/");
        }}
      >
        <p>Margin has stopped. Discarding removes the files it read and anything planned so far. Keep it as a draft to finish setting it up later from Your projects.</p>
      </ConfirmDialog>
    </div>
  );
}
