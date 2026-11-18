'use client';

// offline stock work on the web. a movement made without signal waits in IndexedDB with the id
// made on this device and goes out when the connection is back. the server treats the id as an
// idempotency key, so a movement sent twice counts once (thinking/05-inventory.md). only stock
// movements work offline, everything else needs the connection.

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CustockApi, MovementBatchResult, MovementInput } from '@custock/core';
import { idbAll, idbAvailable, idbDelete, idbPut, idbWipe } from './idb';

export interface OutboxRow {
  id: string; // the movement id (uuid v7 made here), also the idempotency key on the server
  orgId: string;
  payload: MovementInput;
  status: 'queued' | 'rejected';
  reason: string | null; // the error code from the server when it was refused
  createdAt: number;
}

// ---------------------------------------------------------------- state for the ui

type Listener = (rows: OutboxRow[]) => void;
const listeners = new Set<Listener>();
let current: OutboxRow[] = [];

async function publish() {
  current = idbAvailable() ? (await idbAll<OutboxRow>('outbox').catch(() => [])).sort((a, b) => a.createdAt - b.createdAt) : [];
  for (const l of listeners) l(current);
}

export function useOutbox(): { rows: OutboxRow[]; queued: number; rejected: OutboxRow[] } {
  const [rows, setRows] = useState<OutboxRow[]>(current);
  useEffect(() => {
    listeners.add(setRows);
    void publish();
    return () => { listeners.delete(setRows); };
  }, []);
  return { rows, queued: rows.filter((r) => r.status === 'queued').length, rejected: rows.filter((r) => r.status === 'rejected') };
}

// ---------------------------------------------------------------- connection

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

// no answer at all, or the proxy saying the app behind it is away, both mean "try later"
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const status = (e as { status?: number })?.status;
  return status === 502 || status === 503 || status === 504;
}

// ---------------------------------------------------------------- sending

export interface SubmitResult {
  queued: boolean; // true when it waits on this device
  result: MovementBatchResult | null;
}

export async function submitMovements(api: CustockApi, orgId: string, movements: MovementInput[]): Promise<SubmitResult> {
  if (!idbAvailable()) return { queued: false, result: await api.postMovements(orgId, movements) };
  // anything still waiting goes first, so the order on the server matches the order here
  const waiting = (await idbAll<OutboxRow>('outbox').catch(() => [])).filter((r) => r.status === 'queued');
  if (!waiting.length && navigator.onLine) {
    try {
      return { queued: false, result: await api.postMovements(orgId, movements) };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  const now = Date.now();
  await idbPut('outbox', movements.map((m, i): OutboxRow => ({ id: m.id, orgId, payload: m, status: 'queued', reason: null, createdAt: now + i })));
  await publish();
  void flush(api).catch(() => {});
  return { queued: true, result: null };
}

let flushing: Promise<number> | null = null;

// sends what waits, oldest first, 50 at a time. returns how many went out.
export function flush(api: CustockApi): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    try {
      if (!idbAvailable()) return 0;
      const rows = (await idbAll<OutboxRow>('outbox')).filter((r) => r.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
      const byOrg = new Map<string, OutboxRow[]>();
      for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
      for (const [orgId, list] of byOrg) {
        for (let i = 0; i < list.length; i += 50) {
          const chunk = list.slice(i, i + 50);
          let res: MovementBatchResult;
          try {
            res = await api.postMovements(orgId, chunk.map((r) => r.payload));
          } catch (e) {
            if (isNetworkError(e)) return sent;
            throw e;
          }
          await idbDelete('outbox', [...res.accepted, ...res.duplicates]);
          const refused = new Map(res.rejected.map((r) => [r.id, r.code]));
          const back = chunk.filter((r) => refused.has(r.id)).map((r) => ({ ...r, status: 'rejected' as const, reason: refused.get(r.id) ?? 'internal' }));
          if (back.length) await idbPut('outbox', back);
          sent += res.accepted.length + res.duplicates.length;
        }
      }
      return sent;
    } finally {
      flushing = null;
      await publish();
    }
  })();
  return flushing;
}

export async function discardRejected(ids: string[]): Promise<void> {
  await idbDelete('outbox', ids);
  await publish();
}

// flush when the connection comes back, when the page comes to the front, and every minute
let stopWatching: (() => void) | null = null;
export function startOfflineSync(api: CustockApi, onFlushed?: (n: number) => void): () => void {
  stopWatching?.();
  const run = () => void flush(api).then((n) => { if (n > 0) onFlushed?.(n); }).catch(() => {});
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => { if (current.some((r) => r.status === 'queued')) run(); }, 60_000);
  run();
  stopWatching = () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    stopWatching = null;
  };
  return stopWatching;
}

// on sign out nothing of the person stays on the device
export async function wipeLocal(): Promise<void> {
  stopWatching?.();
  if (idbAvailable()) await idbWipe().catch(() => {});
  await publish();
}
