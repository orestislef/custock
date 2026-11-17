import { describe, expect, it, beforeAll } from 'vitest';
import { migrate, openDb, seed, hashPassword, verifyPassword, type Db, type SeedResult } from '../src/index';

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
    expect(row.n).toBe(1);
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
