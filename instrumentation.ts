/**
 * Runs once when the server starts. Opening the database applies any pending migrations, so the first page never meets a missing table
 * after an update. Then background writing starts: every approved layer not written yet is written, one at a time
 * (lib/layers/background.ts). MARGIN_BACKGROUND=off turns it off (the browser tests do). Only in the Node.js runtime: the database needs
 * native modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("@/lib/db/client");
  getDb();
  if (process.env.MARGIN_BACKGROUND === "off") return;
  const [{ getEngine }, { startBackground }] = await Promise.all([import("@/lib/ai"), import("@/lib/layers/background")]);
  startBackground({ db: getDb, engine: getEngine });
}
