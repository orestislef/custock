import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './open';
import * as schema from './schema';

export { openDb, migrate, MIGRATIONS_DIR, hasFts5, hasSearchIndex, rebuildSearch, type Db } from './open';
export { seed, type SeedResult } from './seed';
export { seedBig, type SynthOptions, type SynthResult } from './synth';
export { hashPassword, verifyPassword, burnPasswordCheck, sha256, randomToken } from './password';
export { schema };

export function orm(db: Db) {
  return drizzle(db, { schema });
}
export type Orm = ReturnType<typeof orm>;

// apps/api/data/custock.db, gitignored
export const DEFAULT_DB_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'api', 'data', 'custock.db');
