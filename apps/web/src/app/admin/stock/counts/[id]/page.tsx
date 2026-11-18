'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { StockCount, UncountedPolicy } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Group, Row, Segmented, signed } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconBarcode, IconChevronLeft, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { ProductPicker } from '@/components/admin/product-picker';
import { money, number, relative } from '@/lib/format';

// a stock count: count first without seeing the expected numbers, then a reviewer sees the
// differences and applies them. thinking/05-inventory.md, stock counts.
export default function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const count = useAsync(() => api.stockCount(org.orgId, id), [id]);
  const [code, setCode] = useState('');
  const [policy, setPolicy] = useState<UncountedPolicy>('ignore');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const c = count.data;
  if (!c) return <div className="pt-6"><div className="h-40 skel" /></div>;

  const shopName = shops.find((s) => s.id === c.shopId)?.name ?? '';
  const canCount = can('stock.count', c.shopId) && c.status === 'open';
  const canApprove = can('stock.count.approve', c.shopId) && c.status === 'review';
  const valueShown = c.lines.some((l) => l.differenceCostMinor != null);
  const totalValue = c.lines.reduce((a, l) => a + (l.differenceCostMinor ?? 0), 0);

  async function run(fn: () => Promise<StockCount | unknown>, msg?: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'lines' in r) count.setData(r as StockCount);
      else await count.reload();
      if (msg) toast(msg);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    const value = code.trim();
    if (!value) return;
    setCode('');
    try {
      const r = await api.scan(org.orgId, value, undefined, c!.shopId);
      if (!r.variantId) { toast(t('counts.unknownCode', { code: value })); return; }
      await api.setCountLine(org.orgId, id, r.variantId, r.packQty || 1, 'add');
      await count.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <div className="page-in pt-2 max-w-[820px]">
      <Link href="/admin/stock/counts" className="inline-flex items-center min-h-[44px] -ml-2 t-body"><IconChevronLeft size={24} />{t('counts.title')}</Link>
      <p className="t-sub t-2 m-0 mt-2">{t(`counts.kind.${c.kind}`)} · {t('counts.started', { when: relative(c.startedAt, locale) })}</p>
      <h1 className="t-title1 t-display m-0 mt-1">{shopName}</h1>
      <p className="mt-2 mb-6"><span className="badge badge-gray">{t(`counts.status.${c.status}`)}</span></p>

      {canCount ? (
        <div className="flex gap-2 items-center mb-5">
          <form className="search flex-1" style={{ height: 44 }} onSubmit={(e) => { e.preventDefault(); void scan(); }}>
            <IconBarcode size={20} />
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus placeholder={t('counts.scanPh')} aria-label={t('counts.scanPh')} />
          </form>
          <button type="button" className="btn btn-tinted" onClick={() => setPicking(true)}><IconPlus size={18} />{t('counts.addProduct')}</button>
        </div>
      ) : null}
      <ProductPicker open={picking} title={t('counts.addProduct')} onClose={() => setPicking(false)}
        onPick={({ variantId }) => { setPicking(false); void run(() => api.setCountLine(org.orgId, id, variantId, 1, 'add')); }} />

      <Group
        title={c.status === 'open' ? t('counts.counted') : t('counts.differences')}
        footer={c.status === 'open' ? t('counts.blindFoot') : valueShown ? t('counts.valueFoot', { value: money(totalValue, org.currency, locale) }) : undefined}
      >
        {c.lines.length ? c.lines.map((l) => (
          <Row
            key={l.variantId}
            title={l.name}
            subtitle={c.status === 'open'
              ? `${l.countedByName ?? ''} · ${relative(l.countedAt, locale)}`
              : `${t('counts.expected', { n: number(l.expectedQty, locale) })} · ${t('counts.countedN', { n: number(l.countedQty, locale) })}${l.differenceCostMinor != null ? ` · ${money(l.differenceCostMinor, org.currency, locale)}` : ''}`}
            trailing={c.status === 'open' && canCount ? (
              <input
                className="t-title3 tnum text-right bg-transparent border-0 outline-none w-20 rounded-[8px] px-2 py-1"
                style={{ background: 'var(--c-fill)' }}
                inputMode="numeric"
                aria-label={t('counts.setQty', { name: l.name })}
                defaultValue={l.countedQty}
                onBlur={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n) && n !== l.countedQty) void run(() => api.setCountLine(org.orgId, id, l.variantId, n, 'set')); }}
              />
            ) : c.status === 'open' ? (
              <span className="t-title3 tnum">{number(l.countedQty, locale)}</span>
            ) : (
              <span className="t-title3 tnum" style={{ color: l.difference < 0 ? 'var(--c-neg-text)' : l.difference > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>
                {signed(l.difference, number(Math.abs(l.difference), locale))}
              </span>
            )}
          />
        )) : <Row title={<span className="t-2">{t('counts.noLines')}</span>} />}
      </Group>

      {canCount ? (
        <div className="flex gap-2 flex-wrap mb-10">
          <button type="button" className="btn btn-primary" disabled={busy || !c.lines.length} onClick={() => void run(() => api.submitCount(org.orgId, id), t('counts.submitted'))}>{t('counts.submit')}</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => api.cancelCount(org.orgId, id), t('counts.cancelled'))}>{t('counts.cancel')}</button>
        </div>
      ) : null}

      {canApprove ? (
        <section className="mb-10">
          {c.kind === 'full' ? (
            <section className="inset-group">
              <h2 className="inset-group-head">{t('counts.uncountedQ')}</h2>
              <div className="px-1"><Segmented label={t('counts.uncountedQ')} value={policy} onChange={setPolicy} options={[{ value: 'ignore', label: t('counts.leave') }, { value: 'set_zero', label: t('counts.zero') }]} /></div>
              <p className="inset-group-foot">{t(`counts.uncountedFoot.${policy}`)}</p>
            </section>
          ) : null}
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api.applyCount(org.orgId, id, c.kind === 'full' ? policy : 'ignore'), t('counts.applied'))}>{t('counts.apply')}</button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => api.cancelCount(org.orgId, id), t('counts.cancelled'))}>{t('counts.cancel')}</button>
          </div>
        </section>
      ) : c.status === 'review' ? <p className="t-sub t-2">{t('counts.waitingApproval')}</p> : null}
    </div>
  );
}
