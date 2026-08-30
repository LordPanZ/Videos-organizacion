import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LATEST_VERSION, MIGRATIONS } from './migrations/index.ts';

export type Db = Database.Database;

export interface OpenOptions {
  /** Absolute path to the SQLite file, or ':memory:' for tests. */
  file: string;
  readonly?: boolean;
  verbose?: (message?: unknown, ...rest: unknown[]) => void;
}

/**
 * Opens the library database, applying any pending migrations.
 *
 * WAL is enabled so the UI can keep reading while imports and downloads write.
 */
export function openDatabase({ file, readonly = false, verbose }: OpenOptions): Db {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new Database(file, { readonly, verbose });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  // ~64 MB page cache: the grid queries touch a lot of rows when faceting.
  db.pragma('cache_size = -64000');
  db.pragma('busy_timeout = 5000');

  if (!readonly) migrate(db);

  return db;
}

/** Applies every migration newer than the file's recorded `user_version`. */
export function migrate(db: Db): void {
  const current = Number(db.pragma('user_version', { simple: true }));
  if (current >= LATEST_VERSION) return;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);

  // Foreign keys cannot be toggled inside a transaction, so do it around one.
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      for (const migration of pending) {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      }
    });
    run();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Reclaims space and refreshes the query planner's statistics. */
export function optimize(db: Db): void {
  db.pragma('optimize');
  db.exec('ANALYZE');
}

/** Compacts the database file. Slow; offered as an explicit maintenance action. */
export function vacuum(db: Db): void {
  db.exec('VACUUM');
}

/** Writes a consistent snapshot to `destination` while the app keeps running. */
export async function backupTo(db: Db, destination: string): Promise<void> {
  mkdirSync(path.dirname(destination), { recursive: true });
  await db.backup(destination);
}
