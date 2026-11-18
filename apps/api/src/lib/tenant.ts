// every business query goes through here, so the org filter cannot be forgotten.
// sql must reference @org. lists are passed as json and read with json_each.

import type { Db } from '@custock/db';

type Named = Record<string, unknown>;
// any parameters: the callers pass named objects and positional lists
type Statement = import('better-sqlite3').Statement<unknown[]>;

// prepared statements are kept per database and reused: preparing the same sql on every call was
// the biggest cost of a request (a batch of 50 sales prepared a few hundred statements). sqlite
// re-prepares a kept statement by itself when the schema changes. the least recently used ones go
// past a cap, so sql built at run time cannot grow it without end.
const STATEMENT_CAP = 1000;
const statements = new WeakMap<Db, Map<string, Statement>>();

export function prepared(db: Db, sql: string): Statement {
  let byDb = statements.get(db);
  if (!byDb) {
    byDb = new Map();
    statements.set(db, byDb);
  }
  let st = byDb.get(sql);
  if (st) {
    byDb.delete(sql);
  } else {
    st = db.prepare<unknown[]>(sql);
    if (byDb.size >= STATEMENT_CAP) byDb.delete(byDb.keys().next().value as string);
  }
  byDb.set(sql, st);
  return st;
}

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
  // set when the caller acts here through the platform role (a super admin who is not a member).
  // audit() marks those rows as platform_admin and copies them to the platform audit
  viaPlatform = false;

  constructor(
    readonly db: Db,
    readonly orgId: string,
  ) {}

  all<T>(sql: string, params: Named = {}, positional: unknown[] = []): T[] {
    check(sql);
    return prepared(this.db, sql).all(...positional, bind({ ...params, org: this.orgId })) as T[];
  }

  get<T>(sql: string, params: Named = {}, positional: unknown[] = []): T | undefined {
    check(sql);
    return prepared(this.db, sql).get(...positional, bind({ ...params, org: this.orgId })) as T | undefined;
  }

  run(sql: string, params: Named = {}, positional: unknown[] = []) {
    check(sql);
    return prepared(this.db, sql).run(...positional, bind({ ...params, org: this.orgId }));
  }
}

// platform level queries (users, sessions, public lookups by code) say so explicitly
export function platform(db: Db) {
  return {
    all: <T>(sql: string, params: Named = {}) => prepared(db, sql).all(bind(params)) as T[],
    get: <T>(sql: string, params: Named = {}) => prepared(db, sql).get(bind(params)) as T | undefined,
    run: (sql: string, params: Named = {}) => prepared(db, sql).run(bind(params)),
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
