// every business query goes through here, so the org filter cannot be forgotten.
// sql must reference @org. lists are passed as json and read with json_each.

import type { Db } from '@custock/db';

type Named = Record<string, unknown>;

function check(sql: string) {
  if (!sql.includes('@org')) throw new Error(`tenant query without @org: ${sql.slice(0, 80)}`);
}

function bind(params: Named): Named {
  const out: Named = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) out[k] = null;
    else if (Array.isArray(v)) out[k] = JSON.stringify(v);
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}

export class Tenant {
  constructor(
    readonly db: Db,
    readonly orgId: string,
  ) {}

  all<T>(sql: string, params: Named = {}, positional: unknown[] = []): T[] {
    check(sql);
    return this.db.prepare(sql).all(...positional, bind({ ...params, org: this.orgId })) as T[];
  }

  get<T>(sql: string, params: Named = {}, positional: unknown[] = []): T | undefined {
    check(sql);
    return this.db.prepare(sql).get(...positional, bind({ ...params, org: this.orgId })) as T | undefined;
  }

  run(sql: string, params: Named = {}, positional: unknown[] = []) {
    check(sql);
    return this.db.prepare(sql).run(...positional, bind({ ...params, org: this.orgId }));
  }
}

// platform level queries (users, sessions, public lookups by code) say so explicitly
export function platform(db: Db) {
  return {
    all: <T>(sql: string, params: Named = {}) => db.prepare(sql).all(bind(params)) as T[],
    get: <T>(sql: string, params: Named = {}) => db.prepare(sql).get(bind(params)) as T | undefined,
    run: (sql: string, params: Named = {}) => db.prepare(sql).run(bind(params)),
  };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: number };
    return Math.max(0, Number(v.o) || 0);
  } catch {
    return 0;
  }
}

export function page<T>(rows: T[], offset: number, limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
}

export function clampLimit(v: string | undefined, def = 50, max = 200): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
}

export const parseJson = <T>(text: string | null | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
