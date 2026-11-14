import { describe, expect, it } from "vitest";
import { isDontGetIt, layerCoversWriting, SAVE_CHOICES, wordingKept } from "@/lib/layers/loop";

describe("the good-enough command is gone", () => {
  it("typing it is just a write-back now, with no special meaning in the loop module", async () => {
    const loop = (await import("@/lib/layers/loop")) as Record<string, unknown>;
    expect(loop.isGoodEnough).toBeUndefined();
    expect(loop.stateOf).toBeUndefined();
  });
  it("the three answers to \"Send to Note to Self?\"", () => expect([...SAVE_CHOICES]).toEqual(["own", "refined", "no"]));
});

describe("I don't get it detector", () => {
  it.each([
    ["I don't get it", true],
    ["i dont get it.", true],
    ["I don’t get it!", true],
    ["I don't get it, what is a faction?", false],
    ["Madison says he doesn't get it", false],
  ])("%j -> %s", (text, expected) => expect(isDontGetIt(text)).toBe(expected));
});

describe("cleaned-up version keeps the student's wording", () => {
  const draft = "Madison argues that faction is a group of citizens united by a passion against the rights of others.";
  it("is 1 when nothing changed", () => expect(wordingKept(draft, draft)).toBe(1));
  it("stays high for a light fix", () => expect(wordingKept(draft, draft.replace("a passion", "a common passion"))).toBeGreaterThan(0.9));
  it("is low for a rewrite in another voice", () => expect(wordingKept(draft, "Factions are self-interested blocs that threaten the common good, according to the author.")).toBeLessThan(0.4));
});

describe("grounding", () => {
  const layer = "Madison defines a faction as a number of citizens united by some common impulse of passion adverse to the rights of other citizens.";
  it("stays inside the layer when the writing is about it", () => expect(layerCoversWriting("Madison defines faction as citizens united by passion adverse to rights", layer)).toBe(true));
  it("looks wider when the writing leaves the layer", () => expect(layerCoversWriting("Hamilton discusses taxation, standing armies, treasury, commerce and credit", layer)).toBe(false));
});
