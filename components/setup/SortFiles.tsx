"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { sortFolder } from "@/components/import/sort-folder";

/**
 * Sorting a course's files into weeks, with each step shown in plain words. `auto` starts at once (a draft whose files were read but
 * never sorted); otherwise a button starts it (sorting again after Claude's answer couldn't be used). Leaving the page stops it.
 */
export function SortFiles({ projectId, auto, label = "Sort the files again" }: { projectId: string; auto?: boolean; label?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  const started = useRef(false);

  async function run() {
    setBusy(true);
    setError(null);
    setStep("Starting");
    const ctl = new AbortController();
    work.current = ctl;
    const err = await sortFolder(projectId, setStep, ctl.signal);
    if (ctl.signal.aborted) return;
    work.current = null;
    setBusy(false);
    setStep(null);
    if (err) setError(`Margin couldn't sort these files into weeks. ${err}`);
    else router.refresh();
  }

  useEffect(() => {
    if (auto && !started.current) {
      started.current = true;
      void run();
    }
    return () => {
      work.current?.abort();
      started.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {!auto && (
        <Button variant="accent" onClick={() => void run()} disabled={busy}>
          {busy ? "Sorting" : label}
        </Button>
      )}
      {step && (
        <p className="t-ui text-panel-muted" role="status" aria-live="polite">
          {step}
        </p>
      )}
      {error && (
        <p className="m-field-error max-w-[62ch]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
