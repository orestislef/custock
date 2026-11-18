'use client';

// a very small IndexedDB wrapper for the two things that live on the device: the outbox of stock
// movements made without signal, and a key value store. the service worker opens the same database.

const DB = 'custock';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgraded the database: let go, the next call opens it again
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
    req.onblocked = () => { opening = null; reject(new Error('blocked')); };
  });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'outbox' | 'kv', mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function idbAll<T>(name: 'outbox'): Promise<T[]> {
  return done((await store(name, 'readonly')).getAll()) as Promise<T[]>;
}

export async function idbPut<T>(name: 'outbox', rows: T[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(name, 'readwrite');
  for (const r of rows) tx.objectStore(name).put(r);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

export async function idbDelete(name: 'outbox', ids: string[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(name, 'readwrite');
  for (const id of ids) tx.objectStore(name).delete(id);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return ((await done((await store('kv', 'readonly')).get(key))) as T | undefined) ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await done((await store('kv', 'readwrite')).put(value, key));
}

export async function idbWipe(): Promise<void> {
  const db = await open();
  const tx = db.transaction(['outbox', 'kv'], 'readwrite');
  tx.objectStore('outbox').clear();
  tx.objectStore('kv').clear();
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export const idbAvailable = () => typeof indexedDB !== 'undefined';
