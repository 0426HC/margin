// @vitest-environment jsdom
/** What a layer's frame can show before the layer arrives: the layer being opened and its course's structure, remembered in the browser. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StructureModel } from "@/lib/layers/types";

const model = (id: string, layers: string[]) =>
  ({ project: { id, name: "HIS100 Harbours", courseCode: null, status: "ready", isDemo: false }, weeks: [{ week: 1, label: "Week 1", layers: layers.map((l) => ({ id: l, title: `Layer ${l}`, bigQuestion: "Why?" })) }] }) as unknown as StructureModel;

let peek: typeof import("@/lib/layers/frame-peek");
beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  peek = await import("@/lib/layers/frame-peek");
});

describe("the layer frame's peek", () => {
  it("knows the layer a link opens and the structure its course page had, and hands back the same answer until either changes", () => {
    peek.rememberCourse(model("p1", ["a", "b"]));
    peek.noteOpening("http://localhost:3000/p/p1/l/b?tab=source");
    const first = peek.framePeek();
    expect(first).toMatchObject({ projectId: "p1", layerId: "b" });
    expect(first?.model?.project.name).toBe("HIS100 Harbours");
    expect(peek.framePeek()).toBe(first);
    peek.openingDone("b");
    expect(peek.framePeek()).toBeNull(); // nothing noted, and the address is not a layer
  });

  it("ignores links that aren't layers, and a structure that doesn't hold the layer", () => {
    peek.noteOpening("/p/p1/talk");
    expect(peek.framePeek()).toBeNull();
    peek.rememberCourse(model("p1", ["a"]));
    peek.noteOpening("/p/p1/l/zz");
    expect(peek.framePeek()).toMatchObject({ layerId: "zz", model: null });
  });

  it("a clicked layer link anywhere on the page is noted; with nothing noted, the address says which layer", () => {
    document.body.innerHTML = `<a href="/p/p2/l/c"><span id="inner">Open</span></a>`;
    peek.noteClickedLink({ target: document.getElementById("inner") } as unknown as MouseEvent);
    expect(peek.framePeek()).toMatchObject({ projectId: "p2", layerId: "c" });
    peek.openingDone("c");
    window.history.replaceState(null, "", "/p/p2/l/d");
    expect(peek.framePeek()).toMatchObject({ projectId: "p2", layerId: "d" });
  });

  it("keeps the structures for this tab's session, so a reload can use them", async () => {
    peek.rememberCourse(model("p3", ["e"]));
    vi.resetModules();
    const again = await import("@/lib/layers/frame-peek");
    window.history.replaceState(null, "", "/p/p3/l/e");
    expect(again.framePeek()?.model?.weeks[0].layers[0].title).toBe("Layer e");
  });
});
