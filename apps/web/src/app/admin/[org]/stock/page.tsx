'use client';

import Link from '@/components/admin/org-link';
import { useSearchParams } from 'next/navigation';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Product, StockLevel } from '@custock/core';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { StockTabs } from '@/components/admin/stock-tabs';
import { ProductPicker } from '@/components/admin/product-picker';
import { Chips, Empty, Group, Row, StockBadge, stockState, IconTile, type StockState } from '@/components/ui/kit';
import { Photo, Picker, Tip, isMac, useShortcuts, useToast } from '@/components/ui/client-kit';
import { CategoryPicture } from '@/components/ui/category-picture';
import { Tally } from '@/components/ui/tally';
import { IconBarcode, IconBell, IconPlus, IconSearch, IconChevronDown, IconTag } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { usePaged } from '@/lib/use-paged';
import { MoreRows } from '@/components/ui/more-rows';
import { useMedia } from '@/lib/use-media';
import { productName } from '@/lib/names';
import { qtyNumber, relative } from '@/lib/format';

type Filter = 'all' | 'low' | 'out' | 'negative' | 'waiting' | 'unknown';
type Row_ = Product & { levels: StockLevel[] };

export default function StockPage() {
  return <Suspense><StockList /></Suspense>;
}

function StockList() {
  const { api, org, t, locale, can, settings, shops } = useAdmin();
  const shopId = useShopFilter();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const wide = useMedia('(min-width: 1024px)');
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const cats = useAsync(() => api.categories(org.orgId), []);
  const [resolving, setResolving] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: 'name' | 'total' | string; dir: 1 | -1 }>({ key: 'name', dir: 1 });

  useEffect(() => { const id = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(id); }, [q]);
  const canCreate = can('products.create', null);
  useShortcuts({
    search: useCallback(() => searchRef.current?.focus(), []),
    create: useCallback(() => { if (canCreate) router.push('/admin/stock/new'); }, [canCreate, router]),
  });

  // pages of 100: a big catalog loads as you scroll instead of stopping silently at 200
  const list = usePaged(
    (cursor) => api.products(org.orgId, { q: debounced || undefined, shopId, filter: filter === 'all' || filter === 'unknown' ? undefined : filter, categoryId: category || undefined, limit: 100, cursor }),
    [debounced, shopId, filter, category],
  );
  const unknown = useAsync(() => (can('products.create', null) || can('products.edit', null) ? api.unknownScans(org.orgId, shopId) : Promise.resolve([])), [shopId]);

  const setF = (f: Filter) => { setFilter(f); router.replace(f === 'all' ? '/admin/stock' : `/admin/stock?filter=${f}`); };
  const threshold = settings?.fewLeftThreshold ?? 3;
  const visibleShops = shops.filter((s) => !shopId || s.id === shopId);
  const newTitle = `${t('stock.newProduct')} (${isMac() ? '⌘' : 'Ctrl+'}N)`;

  const stateOf = (p: Row_): { state: StockState; label: string; onHand: number; waiting: number } => {
    const levels = p.levels.filter((l) => !shopId || l.shopId === shopId);
    const onHand = levels.reduce((a, l) => a + l.onHand, 0);
    const waiting = levels.reduce((a, l) => a + l.waiting, 0);
    const state: StockState = levels.some((l) => l.onHand < 0) ? 'negative'
      : shopId ? stockState(onHand, levels[0]?.reorderPoint ?? null, p.uom === 'piece' ? threshold : threshold * 1000)
      : levels.some((l) => l.onHand === 0) ? 'out'
      : levels.some((l) => stockState(l.onHand, l.reorderPoint ?? null, p.uom === 'piece' ? threshold : threshold * 1000) === 'few') ? 'few' : 'in';
    return { state, label: state === 'out' && !shopId ? t('stock.outSomewhere') : t(`common:stock.${state}`), onHand, waiting };
  };

  // the pages come in name order; any other order (a stock column, or names from z) needs the whole
  // list, so the rest is loaded first
  const { hasMore, loadAll } = list;
  const ownOrder = wide && (sort.key !== 'name' || sort.dir !== 1);
  useEffect(() => { if (ownOrder && hasMore) void loadAll(); }, [ownOrder, hasMore, loadAll]);
  const items = useMemo(() => {
    const rows = [...(list.items ?? [])];
    if (!wide) return rows;
    const val = (p: Row_) => sort.key === 'name' ? productName(p, locale).toLowerCase()
      : sort.key === 'total' ? p.levels.reduce((a, l) => a + l.onHand, 0)
      : p.levels.filter((l) => l.shopId === sort.key).reduce((a, l) => a + l.onHand, 0);
    return rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [list.items, wide, sort, locale]);

  const header = (key: string, label: string, num = false) => (
    <th className={num ? 'num' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : num ? -1 : 1 }))}>
        {label}{sort.key === key ? <IconChevronDown size={12} style={{ transform: sort.dir === 1 ? 'rotate(180deg)' : undefined }} /> : null}
      </button>
    </th>
  );

  return (
    <Page
      title={t('stock.title')}
      actions={canCreate ? <Link href="/admin/stock/new" className="btn btn-tinted" title={newTitle}><IconPlus size={18} />{t('stock.newProduct')}</Link> : null}
      phoneAction={canCreate ? <Link href="/admin/stock/new" className="icon-btn" aria-label={t('stock.newProduct')} style={{ background: 'var(--c-accent-tint)' }}><IconPlus size={22} /></Link> : undefined}
    >
      <StockTabs />
      {/* on a phone this screen is already the phone app, the tip is for wide screens */}
      <div className="hidden md:block"><Tip id="stock-scan">{t('stock.tipScan')}</Tip></div>
      <div className="sticky top-[52px] z-10 -mx-4 px-4 md:mx-0 md:px-0 pt-1 pb-3 flex flex-col gap-3" style={{ background: 'var(--c-shelf)' }}>
        <div className="search" style={{ height: 40 }}>
          <IconSearch size={18} />
          <input ref={searchRef} type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stock.search')} aria-label={t('stock.search')} title={t('stock.searchKey')} />
        </div>
        <Chips label={t('stock.filter')} value={filter} onChange={setF}
          options={[
            { value: 'all', label: t('stock.f.all') },
            { value: 'low', label: t('stock.f.low') },
            { value: 'out', label: t('stock.f.out') },
            { value: 'negative', label: t('stock.f.negative') },
            { value: 'waiting', label: t('stock.f.waiting') },
            ...(filter === 'unknown' ? [{ value: 'unknown' as Filter, label: t('stock.f.unknown') }] : []),
          ]} />
        {cats.data?.length ? (
          <div className="flex">
            <Picker variant="filled" label={t('stock.categoryFilter')} value={category} onChange={setCategory}
              icon={(() => { const c = cats.data!.find((x) => x.id === category); return c ? <CategoryPicture iconKey={c.iconKey} imageUrl={c.imageUrl} size={20} rounded={5} /> : <IconTag size={16} />; })()}
              options={[{ value: '', label: t('stock.allCategories') }, ...cats.data.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
        ) : null}
      </div>

      {filter === 'unknown' ? (
        <Group title={t('stock.unknownTitle')} footer={t('stock.unknownFoot')}>
          {(unknown.data ?? []).map((u) => (
            <Row key={u.id} leading={<IconTile><IconBarcode size={18} /></IconTile>} title={<span className="tnum">{u.code}</span>} subtitle={t('stock.unknownSub', { count: u.times, when: relative(u.scannedAt, locale) })}
              trailing={can('products.edit', null) ? <button type="button" className="btn btn-plain" onClick={() => setResolving(u.id)}>{t('stock.attach')}</button> : null} chevron={false} />
          ))}
        </Group>
      ) : list.data && items.length === 0 ? (
        <Empty icon={<IconSearch size={40} />} title={debounced ? t('stock.noResults') : t('stock.emptyTitle')} body={debounced ? t('stock.noResultsBody', { q: debounced }) : t(`stock.empty.${filter}`)} />
      ) : wide ? (
        <table className="table mb-6">
          <thead>
            <tr>
              {header('name', t('stock.col.product'))}
              <th>{t('stock.col.category')}</th>
              {visibleShops.map((s) => header(s.id, s.name, true))}
              {visibleShops.length > 1 ? header('total', t('stock.col.total'), true) : null}
              <th>{t('stock.col.state')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const st = stateOf(p);
              return (
                <tr key={p.id} onClick={() => router.push(`/admin/stock/${p.id}`)}>
                  <td>
                    <Link href={`/admin/stock/${p.id}`} className="flex items-center gap-3 hover:no-underline" style={{ color: 'var(--c-ink)' }} onClick={(e) => e.stopPropagation()}>
                      <Photo src={p.images[0]?.url} alt={productName(p, locale)} size={36} rounded={7} fallback={p.categoryIconKey ? <CategoryPicture iconKey={p.categoryIconKey} size={36} rounded={7} /> : undefined} />
                      <span>{productName(p, locale)}</span>
                    </Link>
                  </td>
                  <td className="t-2">{p.categoryName}</td>
                  {visibleShops.map((s) => {
                    const n = p.levels.filter((l) => l.shopId === s.id).reduce((a, l) => a + l.onHand, 0);
                    return <td key={s.id} className="num" style={{ color: n < 0 ? 'var(--c-neg-text)' : n === 0 ? 'var(--c-ink-3)' : undefined }}>{qtyNumber(n, p.uom, locale).replace('-', '−')}</td>;
                  })}
                  {visibleShops.length > 1 ? <td className="num" style={{ fontWeight: 600 }}>{qtyNumber(st.onHand, p.uom, locale).replace('-', '−')} <span className="t-3" style={{ fontWeight: 400 }}>{t(`common:uom.${p.uom}`)}</span></td> : null}
                  <td>
                    <span className="inline-flex gap-1.5 flex-wrap">
                      <StockBadge state={st.state} label={st.label} />
                      {st.waiting > 0 ? <span className="badge badge-gray"><IconBell size={13} />{t('common:stock.waiting', { count: st.waiting })}</span> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <section className="inset-group">
          <ul className="list" role="list">
            {items.map((p) => {
              const st = stateOf(p);
              return (
                <li key={p.id}>
                  <Link href={`/admin/stock/${p.id}`} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                    <Photo src={p.images[0]?.url} alt={productName(p, locale)} size={44} fallback={p.categoryIconKey ? <CategoryPicture iconKey={p.categoryIconKey} size={44} /> : undefined} />
                    <span className="row-main">
                      <span className="row-title block">{productName(p, locale)}</span>
                      <span className="row-sub flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="truncate">{p.categoryName}</span>
                        <StockBadge state={st.state} label={st.label} />
                        {st.waiting > 0 ? <span className="badge badge-gray"><IconBell size={13} />{t('common:stock.waiting', { count: st.waiting })}</span> : null}
                      </span>
                    </span>
                    {can('stock.view', shopId ?? null) ? (
                      <span className="t-title3 tnum text-right" style={{ minWidth: 56, color: st.onHand < 0 ? 'var(--c-neg-text)' : undefined }}>
                        <Tally value={st.onHand} format={(n) => qtyNumber(n, p.uom, locale)} />
                        <span className="block t-cap t-2" style={{ fontWeight: 400 }}>{t(`common:uom.${p.uom}`)}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
            {!list.data ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="row"><span className="thumb skel" /><span className="row-main"><span className="block h-4 w-2/3 skel" /><span className="block h-3 w-1/3 skel mt-2" /></span></li>
            )) : null}
          </ul>
          <MoreRows {...list.more} />
          {list.data ? <p className="inset-group-foot">{list.hasMore ? t('list.countMore', { count: items.length }) : t('stock.count', { count: items.length })}</p> : null}
        </section>
      )}
      {wide ? <MoreRows {...list.more} /> : null}
      {wide && list.data ? <p className="t-foot t-2 -mt-3 mb-6">{list.hasMore ? t('list.countMore', { count: items.length }) : t('stock.count', { count: items.length })}</p> : null}

      <ProductPicker open={resolving != null} title={t('stock.attachTo')} onClose={() => setResolving(null)} onPick={({ variantId }) => {
        const id = resolving;
        setResolving(null);
        if (id) void api.resolveUnknownScan(org.orgId, id, variantId).then(() => { toast(t('stock.attached')); void unknown.reload(); void list.reload(); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)));
      }} />
    </Page>
  );
}
