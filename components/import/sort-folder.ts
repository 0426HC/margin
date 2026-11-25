/**
 * Ask the server to sort a project's files into weeks (the AI reads the syllabus and the folder), passing each step to `onStep` as it
 * happens. Resolves to null when done, or to a plain error message. Aborting the signal stops the AI call on the server too.
 */
export async function sortFolder(projectId: string, onStep: (step: string) => void, signal?: AbortSignal): Promise<string | null> {
  const LOST = "Margin lost the connection while sorting the files. Check that the app is still running, then try again.";
  const res = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST", signal }).catch(() => null);
  if (!res) return signal?.aborted ? "Stopped." : LOST;
  if (!res.ok || !res.body) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? LOST;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { step?: string; done?: boolean; error?: string };
        if (msg.step) onStep(msg.step);
        if (msg.error) return msg.error;
        if (msg.done) return null;
      }
    }
  } catch {
    return signal?.aborted ? "Stopped." : LOST;
  }
  return LOST;
}
