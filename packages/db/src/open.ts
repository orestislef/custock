import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contactKey, searchKey } from '@custock/core';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

// data fixes that need code, run right after the matching sql file
const FIXUPS: Record<string, (db: Db) => void> = {
  // contact details leave the searchable key and move to an exact match key
  '0003_security.sql': (db) => {
    const rows = db.prepare('SELECT id, name, email, phone FROM customers WHERE erased_at IS NULL').all() as { id: string; name: string | null; email: string | null; phone: string | null }[];
    const upd = db.prepare('UPDATE customers SET search_key = ?, contact_key = ? WHERE id = ?');
    for (const r of rows) upd.run(searchKey(r.name), contactKey(r.email, r.phone), r.id);
  },
};

// forward only. each file runs once, in name order, inside a transaction.
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      FIXUPS[file]?.(db);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    })();
    applied.push(file);
  }
  return applied;
}
