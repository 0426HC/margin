import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { dataDir, dbPath } from "./paths";
import * as schema from "./schema";
import { migrateAllToWeeks } from "@/lib/layers/migrate-weeks";
import { removeStrayNoteCopies } from "@/lib/projects/course-import";

export type Db = BetterSQLite3Database<typeof schema>;

/** Opens a database, turns on foreign keys, and applies any migrations that have not run yet. */
export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // deleted text is overwritten with zeros, not just unlinked, so a deleted project or message leaves nothing readable in the file
  sqlite.pragma("secure_delete = ON");
  const db = drizzle(sqlite, { schema });
  migrateDb(db);
  return { db, sqlite };
}

const migrationsFolder = () => path.join(process.cwd(), "lib/db/migrations");
const journal = () => path.join(migrationsFolder(), "meta", "_journal.json");
/** Changes whenever a migration is added: the journal's size and time. */
const journalStamp = () => {
  try {
    const st = fs.statSync(journal());
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "";
  }
};

/** Apply every migration the database hasn't had yet. Safe to call again: applied ones are skipped. */
export function migrateDb(db: Db) {
  migrate(db, { migrationsFolder: migrationsFolder() });
}

const g = globalThis as unknown as { __marginDb?: Db; __marginJournal?: string };

/**
 * The app's database. One connection, kept across dev reloads. Migrations run when it opens (at server start, see instrumentation.ts),
 * and again if a migration file was added while the server kept running, so an update can never leave the database behind.
 */
export function getDb(): Db {
  fs.mkdirSync(dataDir(), { recursive: true });
  const stamp = journalStamp();
  if (!g.__marginDb) {
    g.__marginDb = openDb(dbPath()).db;
    g.__marginJournal = stamp;
    migrateAllToWeeks(g.__marginDb); // courses from before the weeks round move from Parts to weeks, once
    removeStrayNoteCopies(g.__marginDb); // lecture material copied into Lecture notes before Round 2 is taken out, once
  } else if (g.__marginJournal !== stamp) {
    migrateDb(g.__marginDb);
    g.__marginJournal = stamp;
    migrateAllToWeeks(g.__marginDb);
    removeStrayNoteCopies(g.__marginDb);
  }
  return g.__marginDb;
}
