'use client';

// a copy of the catalog and stock of the shops this person works in, kept on the device from the
// api's sync (changes since a cursor). it lets a scan find its product without signal, so a sale
// or a delivery can be saved in the outbox. wiped with everything else on sign out.

import { normalizeBarcode, type CustockApi, type Product, type StockLevel, type SyncResult } from '@custock/core';
import { idbAvailable, kvGet, kvSet } from './idb';

type Cached = Product & { levels: StockLevel[] };

async function syncShop(api: CustockApi, orgId: string, shopId: string): Promise<void> {
  const cursorKey = `cursor:${orgId}:${shopId}`;
  const cursor = await kvGet<string>(cursorKey);
  let res: SyncResult;
  try {
    res = await api.sync(orgId, shopId, cursor);
  } catch {
    return; // no signal or not allowed: keep what we have
  }
  const products = res.full ? {} : ((await kvGet<Record<string, Product>>(`products:${orgId}`)) ?? {});
  for (const p of res.products) products[p.id] = p;
  for (const id of res.tombstones.products) delete products[id];
  const levels = res.full ? {} : ((await kvGet<Record<string, StockLevel>>(`levels:${orgId}:${shopId}`)) ?? {});
  for (const l of res.levels) levels[l.variantId] = l;
  await kvSet(`products:${orgId}`, products);
  await kvSet(`levels:${orgId}:${shopId}`, levels);
  await kvSet(cursorKey, res.cursor);
}

let lastSync = 0;
export async function syncShops(api: CustockApi, orgId: string, shopIds: string[], force = false): Promise<void> {
  if (!idbAvailable() || !navigator.onLine) return;
  if (!force && Date.now() - lastSync < 5 * 60_000) return;
  lastSync = Date.now();
  for (const s of shopIds) await syncShop(api, orgId, s).catch(() => {});
}

export async function lookupCached(orgId: string, shopIds: string[], code: string): Promise<{ product: Cached; variantId: string; packQty: number } | null> {
  if (!idbAvailable()) return null;
  const norm = normalizeBarcode(code).codeNorm;
  const products = Object.values((await kvGet<Record<string, Product>>(`products:${orgId}`)) ?? {});
  const levels: StockLevel[] = [];
  for (const s of shopIds) levels.push(...Object.values((await kvGet<Record<string, StockLevel>>(`levels:${orgId}:${s}`)) ?? {}));
  for (const p of products) {
    for (const v of p.variants) {
      const b = v.barcodes.find((x) => x.codeNorm === norm || x.code === code);
      if (b) return { product: { ...p, levels: levels.filter((l) => p.variants.some((pv) => pv.id === l.variantId)) }, variantId: v.id, packQty: b.packQty };
    }
  }
  return null;
}

export function resetCatalogSync() { lastSync = 0; }
