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

/** "3:00 pm", or "Thursday at 3:00 pm" when the reset is not today. */
export function resetTime(resetsAt: Date, now = new Date()): string {
  const time = resetsAt.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/^0/, "");
  return resetsAt.toDateString() === now.toDateString() ? time : `${resetsAt.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
}

export class UsageLimitReached extends EngineError {
  /** When the plan's limit resets, if Claude Code said. */
  constructor(readonly resetsAt?: Date) {
    super("UsageLimitReached", `Your Claude plan's usage limit has been reached${resetsAt ? `. It resets at ${resetTime(resetsAt)}` : ""}. Wait for it to reset, then try again.`);
  }
}
export class EngineTimeout extends EngineError {
  constructor(message = "Claude took too long to answer, so Margin stopped waiting. Try again.") {
    super("EngineTimeout", message);
  }
}
/** Anthropic's side is overloaded or briefly down: nothing is wrong with Margin or the plan. */
export class ClaudeBusy extends EngineError {
  constructor() {
    super("ClaudeBusy", "Claude is very busy right now and couldn't answer. Wait a minute, then try again.");
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
// Claude Code's wording has changed over versions: "Claude AI usage limit reached|<time>", "5-hour limit reached ∙ resets 3pm",
// "You've hit your limit · resets 8pm", "rate limit".
const USAGE_LIMIT = /usage limit|limit reached|rate limit|out of (extra )?usage|reached your .*limit|hit your (?:\S+ )?limit|limit (?:exceeded|resets)/i;
const BUSY = /overloaded|\b529\b|api error: 5\d\d|service unavailable|internal server error/i;

/** Map a failed run (stderr, or the text of an error result) to a typed error. */
export function classifyFailure(input: { text?: string; stderr?: string; exitCode?: number | null; spawnError?: NodeJS.ErrnoException; apiStatus?: number | null; resetsAt?: Date }): EngineError {
  if (input.spawnError?.code === "ENOENT") return new ClaudeNotInstalled();
  const text = `${input.text ?? ""}\n${input.stderr ?? ""}\n${input.spawnError?.message ?? ""}`.trim();
  if (NOT_LOGGED_IN.test(text)) return new ClaudeNotLoggedIn();
  if (input.apiStatus === 429 || USAGE_LIMIT.test(text)) return new UsageLimitReached(input.resetsAt);
  if ((input.apiStatus && input.apiStatus >= 500) || BUSY.test(text)) return new ClaudeBusy();
  const detail = text.slice(0, 400) || `exit code ${input.exitCode ?? "unknown"}`;
  return new EngineError("EngineFailed", `Claude stopped with an error: ${detail}`);
}
