'use client';

// names in the reader's language for lists that only carry an id or the default name
// (latest changes, reports, count and transfer lines). one catalog fetch, shared for a minute.

import { useEffect, useState } from 'react';
import type { Category, CustockApi, Product, StockLevel, Uom } from '@custock/core';
import { productName, variantLabel } from './names';

type Catalog = { items: (Product & { levels: StockLevel[] })[] };
const cache = new Map<string, { at: number; p: Promise<Catalog> }>();

// the api localizes displayName by Accept-Language, so one cache entry per language
function load(api: CustockApi, orgId: string, locale: string): Promise<Catalog> {
  const key = `${orgId}:${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = api.products(orgId, { limit: 500 }).catch(() => ({ items: [] }));
  cache.set(key, { at: Date.now(), p });
  return p;
}

export function forgetCatalog(orgId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${orgId}:`)) cache.delete(k);
}

export function useNames(api: CustockApi, orgId: string, locale: string) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    let alive = true;
    void load(api, orgId, locale).then((c) => { if (alive) setCatalog(c); });
    return () => { alive = false; };
  }, [api, orgId, locale]);

  const byVariant = (variantId: string) => catalog?.items.find((p) => p.variants.some((v) => v.id === variantId));
  return {
    ready: Boolean(catalog),
    // the product name in this language, with the variant options when there are several
    variant(variantId: string, fallback = ''): string {
      const p = byVariant(variantId);
      if (!p) return fallback;
      const v = p.variants.find((x) => x.id === variantId);
      const opts = p.variants.length > 1 ? variantLabel(v?.options) : '';
      return opts ? `${productName(p, locale)} · ${opts}` : productName(p, locale);
    },
    product(productId: string, fallback = ''): string {
      const p = catalog?.items.find((x) => x.id === productId);
      return p ? productName(p, locale) : fallback;
    },
    productOfVariant: byVariant,
    uom(variantId: string): Uom {
      return byVariant(variantId)?.uom ?? 'piece';
    },
  };
}

// categories may carry translations once the api adds them, the default name otherwise
export function categoryName(c: Pick<Category, 'name'> & { translations?: Record<string, { name: string }> }, locale: string): string {
  return c.translations?.[locale]?.name ?? c.name;
}
