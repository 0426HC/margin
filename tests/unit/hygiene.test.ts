// @vitest-environment node
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repo hygiene", () => {
  const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

  it("never commits data, databases, uploads or secrets", () => {
    const bad = files.filter((f) => /^\.data\//.test(f) || /\.(db|sqlite|sqlite3|db-wal|db-shm)$/.test(f) || /(^|\/)\.env(\.|$)/.test(f) || /Application Support/.test(f));
    expect(bad).toEqual([]);
  });

  it("never commits audio files", () => {
    // audio is never shipped in the repo
    const audio = files.filter((f) => /\.(wav|mp3|m4a|flac|ogg|aiff?)$/i.test(f));
    expect(audio).toEqual([]);
  });

  it("ships no course files except the public-domain sample course, its sources, the demo seed and the fictional demo exam", () => {
    const demo = files.filter((f) => f.startsWith("demo/"));
    const stray = demo.filter((f) => !(f.startsWith("demo/sample-course/") || f.startsWith("demo/source/") || f === "demo/seed.json" || f.startsWith("demo/exam/")));
    expect(stray).toEqual([]);
    const docs = files.filter((f) => /\.(pdf|docx|pptx)$/i.test(f) && !f.startsWith("demo/") && !f.startsWith("tests/fixtures/"));
    expect(docs).toEqual([]);
  });
});
