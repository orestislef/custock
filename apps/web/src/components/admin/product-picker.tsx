'use client';

import { useState } from 'react';
import type { Product, StockLevel } from '@custock/core';
import { useAdmin } from './admin-context';
import { Photo, Sheet } from '@/components/ui/client-kit';
import { IconSearch } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName, variantLabel } from '@/lib/names';

export type PickedVariant = { product: Product & { levels: StockLevel[] }; variantId: string };

// search the catalog and pick a variant. products with variants list each variant on its own row.
export function ProductPicker({ open, onClose, onPick, title }: { open: boolean; onClose: () => void; onPick: (x: PickedVariant) => void; title: string }) {
  const { api, org, t, locale } = useAdmin();
  const [q, setQ] = useState('');
  const list = useAsync(() => (open ? api.products(org.orgId, { q: q || undefined, limit: 60 }) : Promise.resolve(null)), [open, q]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="search mb-3"><IconSearch size={18} /><input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stock.search')} aria-label={t('stock.search')} /></div>
      <div className="list mb-2">
        {(list.data?.items ?? []).flatMap((p) => p.variants.map((v) => (
          <button key={v.id} type="button" className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties} onClick={() => onPick({ product: p, variantId: v.id })}>
            <Photo src={p.images[0]?.url} alt={productName(p, locale)} size={44} />
            <span className="row-main">
              <span className="row-title block">{productName(p, locale)}</span>
              {p.variants.length > 1 ? <span className="row-sub block">{variantLabel(v.options) || v.sku}</span> : null}
            </span>
          </button>
        )))}
      </div>
    </Sheet>
  );
}
