import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TAB, TABS, openHref, parseTab, rememberTab, rememberedTab, tabHref } from "@/lib/overview/tabs";

describe("course tabs", () => {
  beforeEach(() => window.localStorage.clear());

  it("are in the brief's order", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Layers", "Let’s talk!", "Lecture notes", "Exam room", "Note to Self"]);
    expect(DEFAULT_TAB).toBe("layers");
  });

  it("read the address and ignore anything unknown", () => {
    expect(parseTab("talk")).toBe("talk");
    expect(parseTab(["exam", "talk"])).toBe("exam");
    expect(parseTab("weeks")).toBeNull();
    expect(parseTab(null)).toBeNull();
    expect(tabHref("p1", "note-to-self")).toBe("/p/p1?tab=note-to-self");
  });

  it("remember the last tab per project, and the card opens there", () => {
    expect(openHref("p1", "/p/p1")).toBe("/p/p1");
    rememberTab("p1", "exam");
    expect(rememberedTab("p1")).toBe("exam");
    expect(rememberedTab("p2")).toBeNull();
    expect(openHref("p1", "/p/p1")).toBe("/p/p1?tab=exam");
    expect(openHref("p2", "/p/p2")).toBe("/p/p2");
    // a card that still points to setting the project up keeps its own address
    expect(openHref("p1", "/p/p1/setup")).toBe("/p/p1/setup");
    rememberTab("p1", "layers");
    expect(openHref("p1", "/p/p1")).toBe("/p/p1");
  });

  it("survive blocked storage", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(() => rememberTab("p1", "talk")).not.toThrow();
      expect(rememberedTab("p1")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
