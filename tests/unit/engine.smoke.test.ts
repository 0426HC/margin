// @vitest-environment node
// Real calls to the `claude` CLI. Skipped unless RUN_CLAUDE_SMOKE=1 (they use your plan's usage).
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClaudeCodeEngine } from "@/lib/ai/claude-code-engine";
import { citationsOf } from "./helpers/citations";
import { reviewLayerWriteback, writeExplained } from "@/lib/ai/tasks";

const run = process.env.RUN_CLAUDE_SMOKE === "1" ? describe : describe.skip;

run("real claude -p (Opus 5.5, medium effort)", () => {
  process.env.MARGIN_DATA_DIR ??= mkdtempSync(path.join(os.tmpdir(), "margin-smoke-"));
  const engine = new ClaudeCodeEngine();
  const passages = [
    { file: "fed10.txt", page: 3, text: "By a faction I understand a number of citizens, whether amounting to a majority or minority of the whole, who are united and actuated by some common impulse of passion, or of interest, adverse to the rights of other citizens, or to the permanent and aggregate interests of the community." },
    { file: "fed10.txt", page: 4, text: "There are two methods of curing the mischiefs of faction: the one, by removing its causes; the other, by controlling its effects." },
  ];
  const layer = { title: "What is a faction?", bigQuestion: "What does Madison mean by faction, and how can it be cured?" };

  it("writes a valid Explained layer whose citations were all sent", async () => {
    const { explained, stripped } = await writeExplained(engine, { layer, passages });
    expect(explained.blocks.length).toBeGreaterThanOrEqual(3);
    expect(stripped).toEqual([]);
  }, 180_000);

  it("reviews a wrong write-back: needs_work, with a fix that cites a real page", async () => {
    const { review } = await reviewLayerWriteback(engine, { layer, passages, writing: "Hamilton says a faction is a group that wants to remove the government. The only cure is to ban all groups." });
    expect(review.verdict).toBe("needs_work");
    expect(review.fixes.length).toBeGreaterThan(0);
    expect(review.fixes.flatMap((f) => citationsOf(f.text)).every((c) => passages.some((p) => p.page === c))).toBe(true);
  }, 180_000);
});
