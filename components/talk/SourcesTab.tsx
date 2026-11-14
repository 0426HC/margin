"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentFigure } from "@/components/cinematic/Stage";
import { useAgentTasks } from "@/components/cinematic/useAgentTasks";
import { Button } from "@/components/ui/Button";
import type { CiteHandler } from "@/components/ui/Citation";
import { MarginRow } from "@/components/workspace/MarginGutter";
import type { SourceGroup } from "@/lib/talk/sources";

/**
 * The Librarian's sources: verbatim passages from my files that the conversation rests on, grouped by topic, each with its file and
 * page in the margin. It collects when I leave Let's talk!, or now with the button; while it works it shows as busy.
 */
export function SourcesTab({ projectId, onCite }: { projectId: string; onCite: CiteHandler }) {
  const [groups, setGroups] = useState<SourceGroup[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { running } = useAgentTasks(projectId);
  const busy = finding || running.some((t) => t.kind === "find-sources");
  const wasBusy = useRef(false);

  const load = useCallback(async () => {
    const d = (await fetch(`/api/projects/${projectId}/sources`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { groups: SourceGroup[]; pending: boolean } | null;
    if (!d) return setError("Margin couldn't load the sources. Reload the page.");
    setGroups(d.groups);
    setPending(d.pending);
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once on mount
    void load();
  }, [load]);

  // A run that started elsewhere (leaving a layer, say) shows up here when it ends.
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);

  const find = async () => {
    setFinding(true);
    setError(null);
    setNote(null);
    window.dispatchEvent(new Event("margin:agents"));
    try {
      const r = await fetch(`/api/projects/${projectId}/sources/find`, { method: "POST" });
      const d = (await r.json().catch(() => null)) as { added?: number; skipped?: string; error?: string } | null;
      if (!r.ok) setError(d?.error ?? "The Librarian couldn't finish. Try again.");
      else if (d?.skipped === "nothing-new") setNote("Nothing new has been said since the Librarian last looked.");
      else if (d?.skipped === "already-running") setNote("The Librarian is already working on it.");
      else setNote(d?.added ? `Collected ${d.added} new ${d.added === 1 ? "source" : "sources"}.` : "Nothing new to collect from what you said.");
    } catch {
      setError("Margin lost the connection. Check that the app is still running, then try again.");
    } finally {
      setFinding(false);
      await load();
    }
  };

  const total = groups?.reduce((n, g) => n + g.sources.length, 0) ?? 0;
  return (
    <div className="m-tt-body m-scroll" role="tabpanel" id="talk-panel-sources" aria-labelledby="talk-tab-sources">
      <div className="m-tt-inner">
        <div className="m-tt-bar">
          <p className="m-tt-lede">
            The passages from your files behind what you have talked about, word for word, grouped by topic. The Librarian collects them when you leave Let&rsquo;s talk!.
          </p>
          <Button variant="accent" onClick={() => void find()} disabled={busy}>
            {busy ? "Collecting…" : "Find sources now"}
          </Button>
        </div>
        <div className="m-tt-status" role="status" aria-live="polite">
          {busy ? (
            <span className="m-tt-busy">
              <AgentFigure id="librarian" size={34} mood="busy" /> The Librarian is reading your conversation and looking through your files…
            </span>
          ) : (
            (note ?? (pending ? "There is conversation the Librarian hasn’t read yet." : ""))
          )}
        </div>
        {error && (
          <p className="m-field-error" role="alert">
            {error}
          </p>
        )}
        {groups && total === 0 && !busy && (
          <div className="m-tt-empty">
            <AgentFigure id="librarian" size={56} />
            <p>Nothing collected yet. Talk about your course in Chat; when you leave, or when you press Find sources now, the Librarian gathers the real passages behind it.</p>
          </div>
        )}
        {groups?.map((g) => (
          <section key={g.topic} className="m-tt-topic" aria-label={g.topic}>
            <h3>
              {g.topic} <span>{g.sources.length}</span>
            </h3>
            {g.sources.map((src) => (
              <MarginRow key={src.id} marks={[{ kind: "page", page: src.page, file: src.file }]}>
                <div className="m-q">
                  <p>{src.text}</p>
                  <button type="button" className="m-tt-open" onClick={() => onCite(src.page, src.file, src.text)} aria-label={`Show the original page: ${src.file}, page ${src.page}`}>
                    Show the original page
                  </button>
                </div>
              </MarginRow>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
