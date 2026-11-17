import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate, openDb, seed, hashPassword, verifyPassword, MIGRATIONS_DIR, type Db, type SeedResult } from '../src/index';

let db: Db;
let s: SeedResult;

beforeAll(() => {
  db = openDb(':memory:');
  migrate(db);
  s = seed(db, { passwordHash: hashPassword('custock') });
});

const one = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as T;

describe('migrations', () => {
  it('apply once and record themselves', () => {
    expect(migrate(db)).toEqual([]);
    const row = one<{ n: number }>('SELECT count(*) n FROM schema_migrations');
    expect(row.n).toBe(6);
  });
  it('turn on foreign keys', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('seed', () => {
  it('builds the Lemoni world', () => {
    expect(one<{ n: number }>('SELECT count(*) n FROM shops WHERE org_id = ?', s.orgId).n).toBe(3);
    expect(one<{ n: number }>('SELECT count(*) n FROM products WHERE org_id = ?', s.orgId).n).toBe(14);
    expect(one<{ n: number }>('SELECT count(*) n FROM product_variants WHERE org_id = ?', s.orgId).n).toBe(17);
    expect(s.customers).toBe(40);
    expect(s.movements).toBeGreaterThan(1000);
  });
  it('keeps cached stock equal to the ledger', () => {
    const drift = one<{ n: number }>(`
      SELECT count(*) n FROM stock_levels l
      WHERE on_hand != (SELECT coalesce(sum(qty_delta), 0) FROM stock_movements m WHERE m.shop_id = l.shop_id AND m.variant_id = l.variant_id)`);
    expect(drift.n).toBe(0);
  });
  it('tells the stories the demo needs', () => {
    const level = (shop: string, variant: string) =>
      one<{ on_hand: number }>('SELECT on_hand FROM stock_levels WHERE shop_id = ? AND variant_id = ?', shop, variant).on_hand;
    expect(level(s.shops.kifisia, s.variants['p-thyme-honey']!)).toBe(0);
    expect(level(s.shops.glyfada, s.variants['p-loukoumi']!)).toBe(-1);
    expect(level(s.shops.kifisia, s.variants['p-mastiha']!)).toBe(2);
    const waiting = one<{ n: number }>("SELECT count(*) n FROM stock_alerts WHERE variant_id = ? AND shop_id = ? AND status = 'waiting'", s.variants['p-thyme-honey'], s.shops.kifisia);
    expect(waiting.n).toBe(14);
  });
  it('has a real was price for the offer', () => {
    const lows = one<{ low: number }>(`
      SELECT min(price_minor) low FROM price_history
      WHERE variant_id = ? AND source != 'offer' AND valid_from < ? AND (valid_to IS NULL OR valid_to > ?)`,
      s.variants['p-olive-oil'], Date.now(), Date.now() - 32 * 86_400_000);
    expect(lows.low).toBe(1290);
  });
  it('stores dev passwords as scrypt hashes', () => {
    const u = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', s.users.eleni);
    expect(u.password_hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('custock', u.password_hash)).toBe(true);
    expect(verifyPassword('wrong', u.password_hash)).toBe(false);
  });
});

describe('ledger', () => {
  it('is append only', () => {
    expect(() => db.prepare('UPDATE stock_movements SET qty_delta = 99').run()).toThrow(/append only/);
    expect(() => db.prepare('DELETE FROM stock_movements').run()).toThrow(/append only/);
  });
});

describe('security fixes', () => {
  it('keeps contact details out of the searchable key', () => {
    const c = one<{ search_key: string; contact_key: string; email: string }>("SELECT search_key, contact_key, email FROM customers WHERE email = 'anna@example.com'");
    expect(c.search_key).not.toContain('example');
    expect(c.contact_key).toContain('anna@example.com');
  });
  it('the 0003 fixup moves contacts out of old search keys', () => {
    const old = openDb(':memory:');
    const dir = MIGRATIONS_DIR;
    // apply the first two files, plant an old style key, then the rest
    old.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    for (const f of ['0001_init.sql', '0002_writes.sql']) {
      old.exec(readFileSync(join(dir, f), 'utf8'));
      old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 1);
    }
    old.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES ('o', 'O', 'o', 1)").run();
    old.prepare("INSERT INTO customers (id, org_id, name, email, phone, source, search_key, created_at, updated_at) VALUES ('c', 'o', 'Μαρία', 'm@example.com', '+306900000001', 'staff', 'μαρια m example com 306900000001', 1, 1)").run();
    migrate(old);
    const row = old.prepare("SELECT search_key, contact_key FROM customers WHERE id = 'c'").get() as { search_key: string; contact_key: string };
    expect(row.search_key).not.toContain('306900000001');
    expect(row.contact_key).toBe('m@example.com 306900000001');
  });
  it('seeds even when two image keys share a url', () => {
    const n = one<{ n: number; d: number }>('SELECT count(*) n, count(DISTINCT storage_key) d FROM files');
    expect(n.n).toBe(n.d);
  });
});

describe('search index', () => {
  it('stays in step with products and customers through triggers', async () => {
    const { hasSearchIndex } = await import('../src/index');
    expect(hasSearchIndex(db)).toBe(true);
    const hit = (table: string, q: string) => (db.prepare(`SELECT count(*) n FROM ${table}_fts WHERE ${table}_fts MATCH ?`).get(q) as { n: number }).n;
    expect(hit('products', '"meli"*')).toBe(1);
    db.prepare("UPDATE products SET search_key = 'kapari capers' WHERE id = ?").run(s.products['p-thyme-honey']);
    expect(hit('products', '"meli"*')).toBe(0);
    expect(hit('products', '"kapar"*')).toBe(1);
    expect(hit('customers', '"petrova"*')).toBeGreaterThan(0);
  });
});
