/** One JSON call to the server. Returns null when it worked, or a plain message that says what went wrong. */
export async function call(url: string, method: string, body?: unknown, signal?: AbortSignal): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal }).catch(() => null);
  if (signal?.aborted) return null;
  if (!r) return "Margin lost the connection. Check that the app is still running, then try again.";
  if (r.ok) return null;
  return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work. Try again.";
}
