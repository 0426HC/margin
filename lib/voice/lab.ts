import fs from "node:fs";
import path from "node:path";
import { configSchema, type VoiceConfig } from "./versions";

export { REF_NAME, VERSIONS, configSchema, type VersionId, type VoiceConfig } from "./versions";

// Throwaway helpers for the /lab/voice experiment. Dev only: the page and routes refuse to run in a production build.

export const VOICE_DIR = path.join(process.cwd(), ".data", "voice");
export const CONFIG_FILE = path.join(VOICE_DIR, "config.json");
export const SERVER = `http://127.0.0.1:${process.env.MARGIN_VOICE_PORT ?? "8765"}`;

export function readConfig(): VoiceConfig | null {
  try {
    return configSchema.parse(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    return null;
  }
}

export function writeConfig(c: VoiceConfig) {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(c, null, 2)}\n`);
}

/**
 * One short paragraph of a real layer's Explained tab from the demo, with the [file, p. N] citation removed (it is not spoken).
 * Kept short on purpose: on this Mac Chatterbox makes speech several times slower than real time, and a request that runs
 * past about five minutes is dropped by Node's fetch.
 */
export function demoParagraph(): string {
  const seed = JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "seed.json"), "utf8")) as { layerContent: { explained: { blocks: { type: string; text?: string }[] } }[] };
  const para = seed.layerContent[3].explained.blocks.find((b) => b.type === "paragraph" && b.text)!.text!;
  return para.replace(/\s*\[[^\]]+, p\. \d+\]/g, "");
}

export const SPEED_SENTENCE = "Federalist No. 10 argues that a large republic can control the danger of faction.";
