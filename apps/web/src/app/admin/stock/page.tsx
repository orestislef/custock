'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Empty, Group, Row, Segmented, StockBadge, stockState, IconTile } from '@/components/ui/kit';
import { Photo, Tip, useToast } from '@/components/ui/client-kit';
import { StockTabs } from '@/components/admin/stock-tabs';
import { ProductPicker } from '@/components/admin/product-picker';
import { Tally } from '@/components/ui/tally';
import { IconBarcode, IconBell, IconPlus, IconSearch } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { productName } from '@/lib/names';
import { qtyNumber, relative } from '@/lib/format';

type Filter = 'all' | 'low' | 'out' | 'negative' | 'waiting' | 'unknown';

export default function StockPage() {
  return <Suspense><StockList /></Suspense>;
}

function StockList() {
  const { api, org, t, locale, can, settings } = useAdmin();
  const shopId = useShopFilter();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [resolving, setResolving] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { const id = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(id); }, [q]);

  const list = useAsync(
    () => api.products(org.orgId, { q: debounced || undefined, shopId, filter: filter === 'all' || filter === 'unknown' ? undefined : filter, limit: 200 }),
    [debounced, shopId, filter],
  );
  const unknown = useAsync(() => (can('products.create', null) || can('products.edit', null) ? api.unknownScans(org.orgId, shopId) : Promise.resolve([])), [shopId]);

  const setF = (f: Filter) => { setFilter(f); router.replace(f === 'all' ? '/admin/stock' : `/admin/stock?filter=${f}`); };
  const threshold = settings?.fewLeftThreshold ?? 3;

  return (
    <Page
      title={t('stock.title')}
      actions={can('products.create', null) ? <Link href="/admin/stock/new" className="btn btn-tinted"><IconPlus size={18} />{t('stock.newProduct')}</Link> : null}
    >
      <StockTabs />
      <Tip id="stock-scan">{t('stock.tipScan')}</Tip>
      <div className="flex flex-col gap-3 mb-5">
        <div className="search">
          <IconSearch size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stock.search')} aria-label={t('stock.search')} />
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <Segmented
            label={t('stock.filter')}
            value={filter}
            onChange={setF}
            options={[
              { value: 'all', label: t('stock.f.all') },
              { value: 'low', label: t('stock.f.low') },
              { value: 'out', label: t('stock.f.out') },
              { value: 'negative', label: t('stock.f.negative') },
              { value: 'waiting', label: t('stock.f.waiting') },
              ...(unknown.data?.length ? [{ value: 'unknown' as Filter, label: t('stock.f.unknown') }] : []),
            ]}
          />
        </div>
      </div>

      {filter === 'unknown' ? (
        <Group title={t('stock.unknownTitle')} footer={t('stock.unknownFoot')}>
          {(unknown.data ?? []).map((u) => (
            <Row key={u.id} leading={<IconTile color="var(--c-ink-3)"><IconBarcode size={18} /></IconTile>} title={<span className="tnum">{u.code}</span>} subtitle={t('stock.unknownSub', { count: u.times, when: relative(u.scannedAt, locale) })}
              trailing={can('products.edit', null) ? <button type="button" className="btn btn-plain" onClick={() => setResolving(u.id)}>{t('stock.attach')}</button> : null} />
          ))}
        </Group>
      ) : list.data && list.data.items.length === 0 ? (
        <Empty icon={<IconSearch size={40} />} title={debounced ? t('stock.noResults') : t('stock.emptyTitle')} body={debounced ? t('stock.noResultsBody', { q: debounced }) : t(`stock.empty.${filter}`)} />
      ) : (
        <section className="group">
          <div className="list">
            {(list.data?.items ?? []).map((p) => {
              const levels = p.levels.filter((l) => !shopId || l.shopId === shopId);
              const onHand = levels.reduce((a, l) => a + l.onHand, 0);
              const waiting = levels.reduce((a, l) => a + l.waiting, 0);
              const worst = levels.some((l) => l.onHand < 0) ? 'negative'
                : shopId ? stockState(onHand, levels[0]?.reorderPoint ?? null, p.uom === 'piece' ? threshold : threshold * 1000)
                : levels.some((l) => l.onHand === 0) ? 'out' : levels.some((l) => l.reorderPoint != null && l.onHand <= l.reorderPoint) ? 'few' : 'in';
              const label = worst === 'out' && !shopId ? t('stock.outSomewhere') : t(`common:stock.${worst}`);
              return (
                <Link key={p.id} href={`/admin/stock/${p.id}`} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                  <Photo src={p.images[0]?.url} alt={productName(p, locale)} size={44} />
                  <span className="row-main">
                    <span className="row-title block">{productName(p, locale)}</span>
                    <span className="row-sub flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="truncate">{p.categoryName}</span>
                      <StockBadge state={worst} label={label} />
                      {waiting > 0 ? <span className="badge badge-accent"><IconBell size={13} />{t('common:stock.waiting', { count: waiting })}</span> : null}
                    </span>
                  </span>
                  {can('stock.view', shopId ?? null) ? (
                    <span className="t-title3 tnum text-right" style={{ minWidth: 56, color: onHand < 0 ? 'var(--c-neg-text)' : undefined }}>
                      <Tally value={onHand} format={(n) => qtyNumber(n, p.uom, locale)} />
                      <span className="block t-cap t-2" style={{ fontWeight: 400 }}>{t(`common:uom.${p.uom}`)}</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
            {!list.data ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row"><span className="thumb skel" /><span className="row-main"><span className="block h-4 w-2/3 skel" /><span className="block h-3 w-1/3 skel mt-2" /></span></div>
            )) : null}
          </div>
          {list.data ? <p className="group-foot">{t('stock.count', { count: list.data.items.length })}</p> : null}
        </section>
      )}

      <ProductPicker open={resolving != null} title={t('stock.attachTo')} onClose={() => setResolving(null)} onPick={({ variantId }) => {
        const id = resolving;
        setResolving(null);
        if (id) void api.resolveUnknownScan(org.orgId, id, variantId).then(() => { toast(t('stock.attached')); void unknown.reload(); void list.reload(); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)));
      }} />
    </Page>
  );
}

