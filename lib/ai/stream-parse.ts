// Parses `claude -p --output-format stream-json --include-partial-messages` output, one JSON object per line.
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}
export type ParsedEvent =
  | { type: "text"; delta: string }
  | { type: "result"; text: string; structured?: unknown; usage: Usage; isError: boolean; subtype?: string };

/** Feed it stdout chunks; it returns the events completed so far. Malformed lines are skipped, never thrown. */
export class StreamParser {
  private buffer = "";

  push(chunk: string): ParsedEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((l) => parseLine(l));
  }

  flush(): ParsedEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    return parseLine(rest);
  }
}

export function parseLine(line: string): ParsedEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let o: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- untrusted CLI JSON, checked field by field below
  try {
    o = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (o?.type === "stream_event") {
    const d = o.event?.type === "content_block_delta" ? o.event.delta : null;
    return d?.type === "text_delta" && typeof d.text === "string" ? [{ type: "text", delta: d.text }] : [];
  }
  if (o?.type === "result") {
    return [
      {
        type: "result",
        text: typeof o.result === "string" ? o.result : "",
        structured: o.structured_output,
        subtype: typeof o.subtype === "string" ? o.subtype : undefined,
        isError: o.is_error === true || (typeof o.subtype === "string" && o.subtype.startsWith("error")),
        usage: {
          inputTokens: o.usage?.input_tokens ?? 0,
          outputTokens: o.usage?.output_tokens ?? 0,
          costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : undefined,
        },
      },
    ];
  }
  return [];
}
