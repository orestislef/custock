// recreates the local database from migrations and the seed. pnpm --filter @custock/db reset

import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_DB_PATH, migrate, openDb, seed } from '../src/index';

const path = process.env.CUSTOCK_DB ?? DEFAULT_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) rmSync(path + suffix);

const started = Date.now();
const db = openDb(path);
const applied = migrate(db);
const result = seed(db);
db.close();

console.log(`database ready at ${path}`);
console.log(`migrations: ${applied.join(', ')}`);
console.log(`seeded org Lemoni with ${result.customers} customers and ${result.movements} stock movements in ${Date.now() - started} ms`);
console.log('dev logins (password "custock"): eleni (owner), nikos (admin), maria (manager Kifisia), giorgos (manager Glyfada),');
console.log('  dimitris (staff Kifisia), katerina (staff Marousi), sofia (viewer), anna (customer). all @example.com');
