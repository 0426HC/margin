// Typed engine failures with plain-English messages. Unrecognised failures surface raw, never mislabelled.
export class EngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}
export class ClaudeNotInstalled extends EngineError {
  constructor() {
    super("ClaudeNotInstalled", "Margin couldn't find the `claude` command. Install Claude Code, then restart Margin.");
  }
}
export class ClaudeNotLoggedIn extends EngineError {
  constructor() {
    super("ClaudeNotLoggedIn", "Claude Code isn't logged in. Run `claude` in a terminal, type /login, then try again.");
  }
}
export class UsageLimitReached extends EngineError {
  constructor(detail?: string) {
    super("UsageLimitReached", `Your Claude plan's usage limit has been reached. Wait for it to reset, then try again.${detail ? ` (${detail})` : ""}`);
  }
}
export class EngineTimeout extends EngineError {
  constructor() {
    super("EngineTimeout", "Claude took too long to answer. Try again.");
  }
}
export class BadStructuredOutput extends EngineError {
  constructor(detail: string) {
    super("BadStructuredOutput", `Claude's answer didn't have the expected shape. ${detail}`);
  }
}
export class EngineNotConfigured extends EngineError {
  constructor(what: string) {
    super("EngineNotConfigured", `${what} isn't configured.`);
  }
}
export class EngineAborted extends EngineError {
  constructor() {
    super("EngineAborted", "Cancelled.");
  }
}

const NOT_LOGGED_IN = /not logged in|please run \/login|invalid api key|authentication/i;
const USAGE_LIMIT = /usage limit|limit reached|rate limit|out of (extra )?usage|reached your .*limit/i;

/** Map a failed run (stderr, or the text of an error result) to a typed error. */
export function classifyFailure(input: { text?: string; stderr?: string; exitCode?: number | null; spawnError?: NodeJS.ErrnoException }): EngineError {
  if (input.spawnError?.code === "ENOENT") return new ClaudeNotInstalled();
  const text = `${input.text ?? ""}\n${input.stderr ?? ""}\n${input.spawnError?.message ?? ""}`.trim();
  if (NOT_LOGGED_IN.test(text)) return new ClaudeNotLoggedIn();
  if (USAGE_LIMIT.test(text)) return new UsageLimitReached();
  const detail = text.slice(0, 400) || `exit code ${input.exitCode ?? "unknown"}`;
  return new EngineError("EngineFailed", `Claude stopped with an error: ${detail}`);
}
