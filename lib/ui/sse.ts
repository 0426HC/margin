export interface SseData {
  type?: string;
  delta?: string;
  error?: string;
}

/** Read a server-sent-events response and call `onData` with each event's JSON. Ends when the stream ends or the request is aborted. */
export async function readEvents(r: Response, onData: (d: SseData) => void): Promise<void> {
  if (!r.body) return;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let at = buf.indexOf("\n\n"); at >= 0; at = buf.indexOf("\n\n")) {
      const evt = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const data = JSON.parse(evt.split("\ndata: ")[1] ?? "null") as SseData | null;
      if (data) onData(data);
    }
  }
}
