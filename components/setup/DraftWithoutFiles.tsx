"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SetupBar } from "@/components/import/SetupBar";
import { Button } from "@/components/ui/Button";
import { forgetFolder } from "@/lib/updates/client";

/** A draft that was stopped before any file was read: nothing to plan from, so discard it and start again. */
export function DraftWithoutFiles({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function startAgain() {
    setBusy(true);
    const r = await fetch(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => null);
    if (!r || (!r.ok && r.status !== 404)) {
      setBusy(false);
      setError("Margin couldn't discard the draft. Check that the app is still running, then try again.");
      return;
    }
    void forgetFolder(projectId);
    router.push("/new");
  }
  return (
    <div>
      <SetupBar projectId={projectId} projectName={name} />
      <h1 className="t-h1">{name}</h1>
      <p className="t-body mt-2 max-w-[62ch] text-panel-muted">Margin was stopped before it finished reading any of this course&rsquo;s files, so there is nothing to plan yet. Start again with the course folder.</p>
      {error && (
        <p className="m-field-error mt-4" role="alert">
          {error}
        </p>
      )}
      <div className="mt-6">
        <Button variant="primary" size="lg" onClick={() => void startAgain()} disabled={busy}>
          {busy ? "Starting again" : "Start again"}
        </Button>
      </div>
    </div>
  );
}
