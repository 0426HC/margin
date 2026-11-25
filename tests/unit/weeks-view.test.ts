import { describe, expect, it } from "vitest";
import { weekKey, weekName } from "@/lib/layers/week-names";
import { weekSet } from "@/lib/layers/weeks";

// The course is grouped by week. These replace the tests of the old "Layers | Weeks" sidebar switch and its per-layer week labels,
// both removed when weeks replaced Parts.

describe("week names", () => {
  it("are 'Week 3 · The Constitution', or just 'Week 3' when no topic is stated", () => {
    expect(weekName(3, "The Constitution")).toBe("Week 3 · The Constitution");
    expect(weekName(3, "")).toBe("Week 3");
    expect(weekName(12, null)).toBe("Week 12");
    expect(weekKey(3)).toBe("W3");
  });

  it("week numbers are sorted and never repeat", () => expect(weekSet([3, 1, 3, 2])).toEqual([1, 2, 3]));
});
