// full text search when the database has the FTS5 tables, LIKE on search_key otherwise

import { ftsMatch, searchSql } from '@custock/core';
import { hasSearchIndex, type Db } from '@custock/db';

const known = new WeakMap<Db, boolean>();

export function ftsOn(db: Db): boolean {
  let on = known.get(db);
  if (on === undefined) {
    on = hasSearchIndex(db);
    known.set(db, on);
  }
  return on;
}

// a WHERE fragment with positional params. rowidExpr is the rowid of the searched table in the query.
export function searchClause(db: Db, table: 'products' | 'customers', column: string, rowidExpr: string, query: string): { sql: string; params: string[] } {
  const match = ftsMatch(query);
  if (!match) return { sql: '1=1', params: [] };
  if (ftsOn(db)) return { sql: `${rowidExpr} IN (SELECT rowid FROM ${table}_fts WHERE ${table}_fts MATCH ?)`, params: [match] };
  return searchSql(column, query);
}
