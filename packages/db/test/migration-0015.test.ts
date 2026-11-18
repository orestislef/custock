import { test, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '../src/index';
import { openDb, migrate, seed } from '../src/index';
// the files table is copied over to allow category photos. a database with data from before the
// change keeps every file and every reference, and foreign keys still hold afterwards.
test('0015 rebuilds files on a seeded database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'custock-0015-'));
  const before14 = join(dir, 'migrations');
  rmSync(before14, { recursive: true, force: true });
  mkdirSync(before14);
  for (const f of readdirSync(MIGRATIONS_DIR)) if (f.endsWith('.sql') && f < '0015') copyFileSync(join(MIGRATIONS_DIR, f), join(before14, f));
  const db = openDb(join(dir, 't.db'));
  migrate(db, before14);
  seed(db);
  const before = (db.prepare('SELECT count(*) n FROM files').get() as { n: number }).n;
  const refs = (db.prepare('SELECT count(*) n FROM product_images').get() as { n: number }).n;
  const applied = migrate(db);
  expect(applied).toContain('0015_category_pictures.sql');
  expect((db.prepare('SELECT count(*) n FROM files').get() as { n: number }).n).toBe(before);
  expect((db.prepare('SELECT count(*) n FROM product_images').get() as { n: number }).n).toBe(refs);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'files'").get() as { sql: string }).sql;
  expect(sql).toContain("'category'");
  const fk = db.prepare("SELECT m.name AS t, f.\"table\" AS ref FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND f.\"table\" LIKE 'files%'").all();
  expect(fk.length).toBeGreaterThan(3);
  // a reference to a missing file is still refused after the copy
  expect(() => db.prepare("UPDATE users SET avatar_file_id = 'nope' WHERE id = (SELECT id FROM users LIMIT 1)").run()).toThrow();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
