import { describe, expect, it } from "vitest";
import { GAP, LEFT, MIN_MID, RIGHT, clamp, nudge, paneLimits } from "@/lib/layout/panes";

describe("nudge", () => {
  it("moves a left pane by 16, or 48 with Shift", () => {
    expect(nudge(272, "ArrowRight", false, LEFT.min, LEFT.max)).toBe(288);
    expect(nudge(272, "ArrowLeft", true, LEFT.min, LEFT.max)).toBe(224);
  });
  it("stays inside its min and max", () => {
    expect(nudge(LEFT.min, "ArrowLeft", true, LEFT.min, LEFT.max)).toBe(LEFT.min);
    expect(nudge(LEFT.max, "ArrowRight", true, LEFT.min, LEFT.max)).toBe(LEFT.max);
  });
  it("grows a right pane when the handle moves left", () => {
    expect(nudge(384, "ArrowLeft", false, RIGHT.min, RIGHT.max, true)).toBe(400);
  });
  it("ignores other keys", () => {
    expect(nudge(300, "Enter", false, LEFT.min, LEFT.max)).toBe(300);
  });
});

describe("paneLimits", () => {
  it("never lets the reading pane drop below its minimum when there is room", () => {
    const width = 1440;
    const { leftMax, rightMax } = paneLimits(width, LEFT.def, RIGHT.def);
    expect(width - 4 * GAP - LEFT.def - rightMax).toBeGreaterThanOrEqual(MIN_MID);
    expect(width - 4 * GAP - leftMax - RIGHT.def).toBeGreaterThanOrEqual(MIN_MID);
  });
  it("falls back to the pane minimums in a very narrow window", () => {
    const { leftMax, rightMax } = paneLimits(700, LEFT.def, RIGHT.def);
    expect(leftMax).toBe(LEFT.min);
    expect(rightMax).toBe(RIGHT.min);
  });
  it("clamp is inclusive", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-1, 1, 3)).toBe(1);
  });
});
