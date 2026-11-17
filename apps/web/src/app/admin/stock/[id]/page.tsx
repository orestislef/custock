'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { MovementBatchResult } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { StockSheet, type StockMode } from '@/components/admin/stock-sheet';
import { Group, Row, StockBadge, Why, stockState } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { Tally } from '@/components/ui/tally';
import { IconBell, IconChevronLeft, IconPlus, IconEdit, IconTruck } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName, variantLabel } from '@/lib/names';
import { money, qtyNumber, relative } from '@/lib/format';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops, shopId, settings } = useAdmin();
  const toast = useToast();
  const product = useAsync(() => api.product(org.orgId, id), [id]);
  const history = useAsync(() => (can('stock.history.view', null) ? api.movements(org.orgId, { shopId: shopId ?? undefined, limit: 30 }) : Promise.resolve(null)), [id, shopId]);
  const [sheet, setSheet] = useState<StockMode | null>(null);
  const [told, setTold] = useState<Record<string, number>>({});

  const p = product.data;
  if (!p) {
    return <div className="pt-6"><div className="h-[240px] skel mb-4" style={{ borderRadius: 16 }} /><div className="h-8 w-1/2 skel" /></div>;
  }

  const variantIds = new Set(p.variants.map((v) => v.id));
  const moves = (history.data?.items ?? []).filter((m) => variantIds.has(m.variantId));
  const threshold = (settings?.fewLeftThreshold ?? 3) * (p.uom === 'piece' ? 1 : 1000);
  const v0 = p.variants[0];
  const canReceive = shops.some((s) => can('stock.receive', s.id));
  const canAdjust = shops.some((s) => can('stock.adjust', s.id));

  function onDone(r: MovementBatchResult) {
    product.setData((cur) => cur && {
      ...cur,
      levels: cur.levels.map((l) => r.levels.find((x) => x.shopId === l.shopId && x.variantId === l.variantId) ?? l),
    });
    void history.reload();
    for (const b of r.backInStock) {
      // the moment stock meets customers: the waiting pill turns into "told"
      setTold((x) => ({ ...x, [`${b.shopId}:${b.variantId}`]: b.notified }));
      toast(t('product.backInStockToast', { count: b.notified }), undefined, 6000);
    }
    for (const l of r.lowStock) toast(t('product.lowStockToast', { shop: shops.find((s) => s.id === l.shopId)?.name ?? '' }));
  }

  return (
    <div className="page-in pt-2">
      <Link href="/admin/stock" className="inline-flex items-center min-h-[44px] -ml-2 t-body"><IconChevronLeft size={24} />{t('stock.title')}</Link>

      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6 mt-2">
        <div>
          <div className="card" style={{ aspectRatio: '4 / 3' }}>
            <Photo src={p.images[0]?.url} alt={productName(p, locale)} className="w-full h-full" rounded={0} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="t-sub t-2 m-0">{[p.categoryName, p.brand].filter(Boolean).join(' · ')}</p>
          <h1 className="t-title1 t-display m-0 mt-1">{productName(p, locale)}</h1>
          {productName(p, locale) !== p.name ? <p className="t-sub t-2 m-0 mt-1">{p.name}</p> : null}
          <div className="flex gap-2 mt-5 flex-wrap">
            {canReceive ? <button type="button" className="btn btn-primary" onClick={() => setSheet('receive')}><IconPlus size={18} />{t('product.receive')}</button> : null}
            {canAdjust ? <button type="button" className="btn btn-gray" onClick={() => setSheet('adjust')}><IconEdit size={18} />{t('product.adjust')}</button> : null}
          </div>
          {!canReceive && !canAdjust ? <p className="mt-3 mb-0"><Why>{t('product.readOnly')}</Why></p> : null}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-x-6 mt-8">
        <div>
          {p.variants.map((v) => (
            <Group key={v.id} title={p.variants.length > 1 ? variantLabel(v.options) : t('product.stockPerShop')} footer={p.variants.length > 1 ? undefined : t('product.stockFoot')}>
              {p.levels.filter((l) => l.variantId === v.id).map((l) => {
                const shop = shops.find((s) => s.id === l.shopId);
                const state = stockState(l.onHand, l.reorderPoint, threshold);
                const toldN = told[`${l.shopId}:${l.variantId}`];
                return (
                  <Row
                    key={l.shopId}
                    title={shop?.name ?? l.shopId}
                    subtitle={
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <StockBadge state={state} label={t(`common:stock.${state}`)} />
                        {l.inTransitIn > 0 ? <StockBadge state="onTheWay" label={`${t('common:stock.onTheWay')} ${qtyNumber(l.inTransitIn, p.uom, locale)}`} /> : null}
                        {toldN ? (
                          <span className="badge badge-ok told-pop">{t('common:stock.told', { count: toldN })}</span>
                        ) : l.waiting > 0 ? (
                          <span className="badge badge-accent"><IconBell size={13} />{t('common:stock.waiting', { count: l.waiting })}</span>
                        ) : null}
                        {l.lastMovementAt ? <span className="t-foot t-2">{relative(l.lastMovementAt, locale)}</span> : null}
                      </span>
                    }
                    trailing={
                      <span className="t-title2 t-display tnum" style={{ color: l.onHand < 0 ? 'var(--c-neg-text)' : undefined }}>
                        <Tally value={l.onHand} format={(n) => qtyNumber(n, p.uom, locale)} />
                      </span>
                    }
                  />
                );
              })}
            </Group>
          ))}

          <Group title={t('product.prices')}>
            <Row
              title={t('product.basePrice')}
              subtitle={!can('products.price.edit', null) ? <Why>{t('common:why.setByAdmin')}</Why> : undefined}
              value={money(v0?.priceMinor, org.currency, locale)}
            />
            {shopId ? (
              <Row
                title={t('product.shopPrice', { shop: shops.find((s) => s.id === shopId)?.name ?? '' })}
                subtitle={can('prices.shop.edit', shopId) ? t('product.shopPriceSub') : <Why>{t('common:why.hiddenForRole')}</Why>}
                value={t('product.samePrice')}
              />
            ) : null}
            {v0 && v0.costMinor !== undefined ? (
              <Row title={t('product.cost')} subtitle={v0.priceMinor && v0.costMinor ? t('product.margin', { pct: Math.round(((v0.priceMinor - v0.costMinor) / v0.priceMinor) * 100) }) : undefined} value={money(v0.costMinor, org.currency, locale)} />
            ) : (
              <Row title={t('product.cost')} subtitle={<Why>{t('product.costHidden')}</Why>} />
            )}
            <Row title={t('product.vat')} value={`${p.taxRateBp / 100}%`} />
          </Group>

          <Group title={t('product.barcodes')} footer={t('product.barcodesFoot')}>
            {p.variants.flatMap((v) => v.barcodes.map((b) => (
              <Row key={b.id} title={<span className="tnum">{b.code}</span>} subtitle={[variantLabel(v.options), b.symbology === 'internal' ? t('product.internalCode') : b.symbology?.toUpperCase()].filter(Boolean).join(' · ')} value={b.packQty > 1 ? `x${b.packQty}` : undefined} />
            )))}
          </Group>
        </div>

        <div>
          {history.data ? (
            <Group title={t('product.history')} footer={moves.length ? t('product.historyFoot') : undefined}>
              {moves.length ? moves.slice(0, 15).map((m) => (
                <Row
                  key={m.id}
                  title={t(`common:movement.${m.kind}`)}
                  subtitle={[shops.find((s) => s.id === m.shopId)?.name, m.createdByName, m.reason ? t(`common:reason.${m.reason}`) : null, relative(m.recordedAt, locale)].filter(Boolean).join(' · ')}
                  value={<span style={{ color: m.qtyDelta > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>{m.qtyDelta > 0 ? '+' : ''}{qtyNumber(m.qtyDelta, p.uom, locale)}</span>}
                />
              )) : <Row title={t('product.noHistory')} />}
            </Group>
          ) : (
            <Group title={t('product.history')}><Row title={<Why>{t('common:why.hiddenForRole')}</Why>} /></Group>
          )}
          {p.levels.some((l) => l.inTransitIn > 0) ? (
            <div className="tip"><IconTruck size={20} /><span className="t-sub">{t('product.transferTip')}</span></div>
          ) : null}
        </div>
      </div>

      {sheet ? <StockSheet open={Boolean(sheet)} mode={sheet} product={p} onClose={() => setSheet(null)} onDone={onDone} /> : null}
    </div>
  );
}
