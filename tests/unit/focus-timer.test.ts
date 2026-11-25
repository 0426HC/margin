import { describe, expect, it } from "vitest";
import { IDLE, advance, ago, stopwatchLine, clock, leftMs, parseStored, pause, readMinutes, remaining, resume, start } from "@/lib/lockin/timer";

const T0 = 1_700_000_000_000;

describe("the focus timer", () => {
  it("takes whole minutes from 1 to 240", () => {
    expect(readMinutes("25")).toBe(25);
    expect(readMinutes(" 1 ")).toBe(1);
    expect(readMinutes("240")).toBe(240);
    for (const bad of ["0", "241", "2.5", "-3", "", "ten"]) expect(readMinutes(bad), bad).toBeNull();
  });

  it("counts down from timestamps, so a slowed background tab can't make it drift", () => {
    const s = start("focus", 25, T0);
    expect(clock(leftMs(s, T0))).toBe("25:00");
    // no ticks at all for ten minutes (a hidden tab): the time left is still exact
    expect(clock(leftMs(s, T0 + 10 * 60_000))).toBe("15:00");
    expect(clock(leftMs(s, T0 + 10 * 60_000 + 500))).toBe("15:00");
    expect(clock(leftMs(s, T0 + 25 * 60_000 - 1))).toBe("00:01");
    expect(remaining(s, T0 + 12.5 * 60_000)).toBeCloseTo(0.5);
  });

  it("finishes when time is up, and not before", () => {
    const s = start("focus", 1, T0);
    expect(advance(s, T0 + 59_999)).toBe(s);
    expect(advance(s, T0 + 60_000)).toEqual({ phase: "finished", kind: "focus", minutes: 1, at: T0 + 60_000 });
    // a tab that was hidden well past the end finishes as soon as it looks again
    expect(advance(s, T0 + 3_600_000).phase).toBe("finished");
  });

  it("pauses and resumes without losing or gaining time", () => {
    const s = start("focus", 10, T0);
    const p = pause(s, T0 + 4 * 60_000);
    expect(p).toMatchObject({ phase: "paused", leftMs: 6 * 60_000 });
    // paused for an hour: nothing changes
    expect(advance(p, T0 + 3_600_000)).toBe(p);
    expect(leftMs(p, T0 + 3_600_000)).toBe(6 * 60_000);
    const r = resume(p, T0 + 3_600_000);
    expect(clock(leftMs(r, T0 + 3_600_000 + 60_000))).toBe("05:00");
  });

  it("a break is five minutes and labelled as a break", () => {
    const b = start("break", 5, T0);
    expect(b).toMatchObject({ kind: "break", minutes: 5 });
    expect(advance(b, T0 + 5 * 60_000)).toEqual({ phase: "finished", kind: "break", minutes: 5, at: T0 + 5 * 60_000 });
  });

  it("the stopwatch says how long you focused, or that the break is over", () => {
    expect(stopwatchLine({ kind: "focus", minutes: 25 })).toBe("25 minutes done. Take 5, or go another round?");
    expect(stopwatchLine({ kind: "focus", minutes: 1 })).toBe("1 minute done. Take 5, or go another round?");
    expect(stopwatchLine({ kind: "break", minutes: 5 })).toBe("Break’s over. Ready for another round?");
    expect(ago(T0, T0 + 30_000)).toBe("just now");
    expect(ago(T0, T0 + 3 * 60_000)).toBe("3 min ago");
  });

  it("restores a stored timer and ignores anything malformed", () => {
    const s = start("focus", 25, T0);
    expect(parseStored(JSON.stringify(s))).toEqual(s);
    expect(parseStored(null)).toBe(IDLE);
    expect(parseStored("{")).toBe(IDLE);
    expect(parseStored(JSON.stringify({ phase: "running", kind: "nap", endsAt: 1 }))).toBe(IDLE);
  });
});
