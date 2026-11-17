import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contactKey, searchKey } from '@custock/core';
import { CATEGORY_NAMES } from './seed';
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
  // full text search tables over the normalised search_key, kept in step by triggers
  // databases seeded before category translations existed get them for the Lemoni demo
  '0006_i18n.sql': (db) => {
    const ins = db.prepare('INSERT OR IGNORE INTO category_translations (category_id, locale, name) VALUES (?, ?, ?)');
    const find = db.prepare("SELECT c.id FROM categories c JOIN organizations o ON o.id = c.org_id WHERE o.slug = 'lemoni' AND c.name = ?");
    for (const [, el, en, ru] of CATEGORY_NAMES) {
      for (const row of find.all(el) as { id: string }[]) {
        ins.run(row.id, 'en', en);
        ins.run(row.id, 'ru', ru);
      }
    }
  },
  '0004_search.sql': (db) => {
    if (!hasFts5(db)) return;
    for (const table of ['products', 'customers']) {
      db.exec(`
        CREATE VIRTUAL TABLE ${table}_fts USING fts5(search_key, content='${table}', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
        CREATE TRIGGER ${table}_fts_ai AFTER INSERT ON ${table} BEGIN
          INSERT INTO ${table}_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
        END;
        CREATE TRIGGER ${table}_fts_ad AFTER DELETE ON ${table} BEGIN
          INSERT INTO ${table}_fts(${table}_fts, rowid, search_key) VALUES ('delete', old.rowid, old.search_key);
        END;
        CREATE TRIGGER ${table}_fts_au AFTER UPDATE OF search_key ON ${table} BEGIN
          INSERT INTO ${table}_fts(${table}_fts, rowid, search_key) VALUES ('delete', old.rowid, old.search_key);
          INSERT INTO ${table}_fts(rowid, search_key) VALUES (new.rowid, new.search_key);
        END;
        INSERT INTO ${table}_fts(${table}_fts) VALUES ('rebuild');
      `);
    }
  },
};

export function hasFts5(db: Db): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x); DROP TABLE temp.fts5_probe;');
    return true;
  } catch {
    return false;
  }
}

// whether the search tables exist in this database
export function hasSearchIndex(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products_fts'").get();
}

// rowids can move after VACUUM INTO or a restore, so the server rebuilds the search index on start
export function rebuildSearch(db: Db): void {
  if (!hasSearchIndex(db)) return;
  db.exec("INSERT INTO products_fts(products_fts) VALUES ('rebuild'); INSERT INTO customers_fts(customers_fts) VALUES ('rebuild');");
}

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
