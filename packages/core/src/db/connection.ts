import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens a database file (or ":memory:") with the pragmas every connection must use. */
export function openDatabase(path: string): Db {
  const sqlite = new Database(path, { create: true, strict: true });
  if (path !== ":memory:") sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA busy_timeout = 5000");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA temp_store = MEMORY");
  sqlite.run("PRAGMA cache_size = -65536"); // 64 MiB page cache
  sqlite.run("PRAGMA mmap_size = 1073741824"); // 1 GiB
  return drizzle({ client: sqlite, schema });
}

/**
 * Applies pending migrations. Run it from exactly one place at startup (the API server); other
 * processes sharing the file (e.g. a frontend importing @sermo/core) must not migrate, because
 * two processes migrating at once can both apply the same migration.
 */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
