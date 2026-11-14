import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { dataDir, dbPath } from "./paths";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

/** Opens a database, turns on foreign keys, and applies any migrations that have not run yet. */
export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "lib/db/migrations") });
  return { db, sqlite };
}

const g = globalThis as unknown as { __marginDb?: Db };

/** The app's database. One connection, kept across dev reloads. */
export function getDb(): Db {
  fs.mkdirSync(dataDir(), { recursive: true });
  return (g.__marginDb ??= openDb(dbPath()).db);
}
