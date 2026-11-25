import os from "node:os";
import path from "node:path";

/** The only place that decides where Margin keeps its data. Dev: ./.data. Production: Application Support. */
export function dataDir(): string {
  if (process.env.MARGIN_DATA_DIR) return process.env.MARGIN_DATA_DIR;
  if (process.env.NODE_ENV === "production") return path.join(os.homedir(), "Library", "Application Support", "Margin");
  // turbopackIgnore: the data folder is read at runtime only; the build must never trace into it.
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
}

export const dbPath = () => path.join(dataDir(), "margin.db");
export const filesDir = () => path.join(dataDir(), "files");
