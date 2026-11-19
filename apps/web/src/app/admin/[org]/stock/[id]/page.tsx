'use client';

import Link from '@/components/admin/org-link';
import { use, useState } from 'react';
import type { MovementBatchResult, StockLevel } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { StockSheet, type StockMode } from '@/components/admin/stock-sheet';
import { ShopSettingsSheet } from '@/components/admin/shop-settings-sheet';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import { Group, Row, StockBadge, signed, stockState } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { CategoryPlaceholder } from '@/components/ui/category-picture';
import { Tally } from '@/components/ui/tally';
import { IconBell, IconChevronLeft, IconPlus, IconEdit, IconTruck, IconGear, IconPrint } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { usePaged } from '@/lib/use-paged';
import { MoreRows } from '@/components/ui/more-rows';
import { StaffMissing, missingFrom } from '@/components/ui/gone';
import { productName, variantLabel } from '@/lib/names';
import { money, qtyNumber, relative } from '@/lib/format';

function variantIdsOf(p: { variants: { id: string }[] }): Set<string> {
  return new Set(p.variants.map((v) => v.id));
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops, shopId, settings } = useAdmin();
  const toast = useToast();
  const product = useAsync(() => api.product(org.orgId, id), [id], { refreshOnReturn: true });
  // this product's own movements, newest first, in pages. (asking for the shop's latest 30 and
  // filtering them here left busy products with an empty history)
  const mayHistory = can('stock.history.view', null);
  const history = usePaged(
    (cursor) => (mayHistory ? api.movements(org.orgId, { productId: id, shopId: shopId ?? undefined, limit: 20, cursor }) : Promise.resolve({ items: [], nextCursor: null })),
    [id, shopId, mayHistory],
  );
  const [sheet, setSheet] = useState<StockMode | null>(null);
  const [told, setTold] = useState<Record<string, number>>({});
  const [shopEdit, setShopEdit] = useState<StockLevel | null>(null);
  const [archiving, setArchiving] = useState(false);
  const router = useRouter();

  const p = product.data;
  const missing = missingFrom(product.error);
  if (!p && missing) return <StaffMissing kind={missing} title={t('gone.product.title')} body={t('gone.product.body')} href="/admin/stock" cta={t('gone.product.cta')} />;
  if (!p) {
    return <div className="pt-6"><div className="h-[240px] skel mb-4" style={{ borderRadius: 16 }} /><div className="h-8 w-1/2 skel" /></div>;
  }

  const moves = history.items ?? [];
  const threshold = (settings?.fewLeftThreshold ?? 3) * (p.uom === 'piece' ? 1 : 1000);
  const v0 = p.variants[0];
  const canReceive = shops.some((s) => can('stock.receive', s.id));
  const canAdjust = shops.some((s) => can('stock.adjust', s.id));

  function onDone(r: MovementBatchResult) {
    product.setData((cur) => cur && {
      ...cur,
      // updated levels replace the old ones, a shop that had none yet is added
      levels: [
        ...cur.levels.map((l) => r.levels.find((x) => x.shopId === l.shopId && x.variantId === l.variantId) ?? l),
        ...r.levels.filter((x) => variantIdsOf(cur).has(x.variantId) && !cur.levels.some((l) => l.shopId === x.shopId && l.variantId === x.variantId)),
      ],
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
      <Link href="/admin/stock" className="inline-flex items-center min-h-[44px] ml-back t-body"><IconChevronLeft size={24} />{t('stock.title')}</Link>

      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6 mt-2">
        <div>
          <div className="card" style={{ aspectRatio: '4 / 3' }}>
            <Photo src={p.images[0]?.url} alt={productName(p, locale)} className="w-full h-full" rounded={0} fallback={p.categoryIconKey ? <CategoryPlaceholder iconKey={p.categoryIconKey} className="w-full h-full" /> : undefined} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="t-sub t-2 m-0">{[p.categoryName, p.brand].filter(Boolean).join(' · ')}</p>
          <h1 className="t-title1 t-display m-0 mt-1">{productName(p, locale)}</h1>
          {productName(p, locale) !== p.name ? <p className="t-sub t-2 m-0 mt-1">{p.name}</p> : null}
          <div className="flex gap-2 mt-5 flex-wrap">
            {canReceive ? <button type="button" className="btn btn-primary" onClick={() => setSheet('receive')}><IconPlus size={18} />{t('product.receive')}</button> : null}
            {canAdjust ? <button type="button" className="btn btn-gray" onClick={() => setSheet('adjust')}>{t('product.adjust')}</button> : null}
            {can('products.edit', null) ? <Link href={`/admin/stock/${p.id}/edit`} className="btn btn-gray"><IconEdit size={18} />{t('common:action.edit')}</Link> : null}
            {can('products.edit', null) && p.variants.some((v) => v.barcodes.length) ? <Link href={`/admin/print/label/${p.id}`} className="btn btn-gray"><IconPrint size={18} />{t('label.open')}</Link> : null}
          </div>
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
                          <span className="badge badge-gray"><IconBell size={13} />{t('common:stock.waiting', { count: l.waiting })}</span>
                        ) : null}
                        {l.lastMovementAt ? <span className="t-foot t-2">{relative(l.lastMovementAt, locale)}</span> : null}
                      </span>
                    }
                    trailing={
                      <span className="inline-flex items-center gap-1">
                        <span className="t-title2 t-display tnum" style={{ color: l.onHand < 0 ? 'var(--c-neg-text)' : undefined }}>
                          <Tally value={l.onHand} format={(n) => qtyNumber(n, p.uom, locale)} />
                        </span>
                        {can('prices.shop.edit', l.shopId) || can('stock.settings.manage', l.shopId) ? (
                          <button type="button" className="icon-btn" style={{ color: 'var(--c-ink-3)' }} aria-label={t('shopSettings.open', { shop: shop?.name ?? '' })} onClick={() => setShopEdit(l)}><IconGear size={18} /></button>
                        ) : null}
                      </span>
                    }
                  />
                );
              })}
            </Group>
          ))}

          <Group title={t('product.prices')}>
            <Row title={t('product.basePrice')} value={money(v0?.priceMinor, org.currency, locale)} />
            {shopId && can('prices.shop.edit', shopId) ? (
              <Row
                title={t('product.shopPrice', { shop: shops.find((s) => s.id === shopId)?.name ?? '' })}
                subtitle={t('product.shopPriceSub')}
                value={(() => {
                  const own = p.levels.find((l) => l.variantId === v0?.id && l.shopId === shopId)?.priceOverrideMinor;
                  return own != null ? money(own, org.currency, locale) : t('product.samePrice');
                })()}
              />
            ) : null}
            {v0 && v0.costMinor !== undefined ? (
              <Row title={t('product.cost')} subtitle={v0.priceMinor && v0.costMinor ? t('product.margin', { pct: Math.round(((v0.priceMinor - v0.costMinor) / v0.priceMinor) * 100) }) : undefined} value={money(v0.costMinor, org.currency, locale)} />
            ) : null}
            <Row title={t('product.vat')} value={`${p.taxRateBp / 100}%`} />
          </Group>

          <Group title={t('product.barcodes')} footer={t('product.barcodesFoot')}>
            {p.variants.flatMap((v) => v.barcodes.map((b) => (
              <Row key={b.id} title={<span className="tnum">{b.code}</span>} subtitle={[variantLabel(v.options), b.symbology === 'internal' ? t('product.internalCode') : b.symbology?.toUpperCase()].filter(Boolean).join(' · ')} value={b.packQty > 1 ? `x${b.packQty}` : undefined} />
            )))}
          </Group>
        </div>

        <div>
          {!can('stock.history.view', null) ? null : history.data ? (
            <Group title={t('product.history')} footer={moves.length ? t('product.historyFoot') : undefined}>
              {moves.length ? moves.map((m) => (
                <Row
                  key={m.id}
                  title={t(`common:movement.${m.kind}`)}
                  subtitle={[shops.find((s) => s.id === m.shopId)?.name, m.createdByName, m.reason ? t(`common:reason.${m.reason}`) : null, relative(m.recordedAt, locale)].filter(Boolean).join(' · ')}
                  value={<span style={{ color: m.qtyDelta > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>{signed(m.qtyDelta, qtyNumber(Math.abs(m.qtyDelta), p.uom, locale))}</span>}
                />
              )) : <Row title={t('product.noHistory')} />}
              {history.hasMore ? <MoreRows {...history.more} /> : null}
            </Group>
          ) : (
            <Group title={t('product.history')}><Row title={<span className="inline-block h-4 w-40 skel" />} /></Group>
          )}
          {p.levels.some((l) => l.inTransitIn > 0) ? (
            <div className="tip"><IconTruck size={20} /><span className="t-sub">{t('product.transferTip')}</span></div>
          ) : null}
        </div>
      </div>

      {can('products.archive', null) && !p.archivedAt ? (
        <div className="mt-6 mb-10">
          {archiving ? (
            <div className="card p-4 max-w-[520px]">
              <p className="t-sub m-0">{t('product.archiveConfirm')}</p>
              <div className="flex gap-2 mt-3">
                <button type="button" className="btn btn-danger" style={{ background: 'var(--c-neg-tint)' }} onClick={() => void api.archiveProduct(org.orgId, p.id).then(() => { toast(t('product.archived')); router.replace('/admin/stock'); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)))}>{t('product.archive')}</button>
                <button type="button" className="btn btn-gray" onClick={() => setArchiving(false)}>{t('common:action.cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setArchiving(true)}>{t('product.archive')}</button>
          )}
        </div>
      ) : null}
      {shopEdit ? <ShopSettingsSheet product={p} level={shopEdit} onClose={() => setShopEdit(null)} onSaved={() => void product.reload()} /> : null}
      {sheet ? <StockSheet open={Boolean(sheet)} mode={sheet} product={p} onClose={() => setSheet(null)} onDone={onDone} /> : null}
    </div>
  );
}
