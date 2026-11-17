'use client';

import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { BarList, ChartCard, ColumnChart, DataTable, FunnelBars, Legend } from '@/components/admin/charts';
import { Why } from '@/components/ui/kit';
import { useAsync } from '@/lib/use-async';
import { date, money, number, qtyNumber } from '@/lib/format';
import type { Uom } from '@custock/core';

export default function ReportsPage() {
  const { api, org, t, locale, can } = useAdmin();
  const shopId = useShopFilter();
  const moneyOk = can('reports.financial.view', shopId ?? null);
  const allowed = can('reports.view', shopId ?? null);
  const none = <T,>(v: T) => Promise.resolve(v);
  const sales = useAsync(() => (allowed && moneyOk ? api.salesSeries(org.orgId, shopId, 14) : none([])), [shopId, allowed]);
  const top = useAsync(() => (allowed ? api.topSellers(org.orgId, shopId, 14) : none([])), [shopId, allowed]);
  const wanted = useAsync(() => (allowed ? api.mostWanted(org.orgId, shopId) : none([])), [shopId, allowed]);
  const links = useAsync(() => (allowed && can('customers.view', null) && org.orgPerms.includes('reports.view') ? api.joinLinkStats(org.orgId) : none([])), [allowed]);
  // top sellers come without a unit for now, so the unit is looked up from the catalog
  const catalog = useAsync(() => (allowed ? api.products(org.orgId, { limit: 500 }) : Promise.resolve(null)), [allowed]);
  const uomOf = (variantId: string, row?: { uom?: Uom }): Uom => row?.uom ?? catalog.data?.items.find((p) => p.variants.some((v) => v.id === variantId))?.uom ?? 'piece';
  const units = (variantId: string, qty: number, row?: { uom?: Uom }) => { const u = uomOf(variantId, row); return u === 'piece' ? number(qty, locale) : `${qtyNumber(qty, u, locale)} ${t(`common:uom.${u}`)}`; };
  const shrink = useAsync(() => (allowed ? api.shrinkage(org.orgId, shopId, 30) : none([])), [shopId, allowed]);

  if (!allowed) return <Page title={t('reports.title')}><Why>{t('common:error.forbidden')}</Why></Page>;

  const eur = (n: number) => money(n, org.currency, locale);
  const eurAxis = (n: number) => new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', { style: 'currency', currency: org.currency, notation: 'compact', maximumFractionDigits: 1 }).format(n / 100);
  const days = (sales.data ?? []).map((p) => {
    const ms = new Date(`${p.day}T12:00:00Z`).getTime();
    return { key: p.day, label: date(ms, locale, { day: 'numeric' }), long: date(ms, locale, { weekday: 'long', day: 'numeric', month: 'long' }), value: p.value };
  });
  const total = days.reduce((a, d) => a + d.value, 0);
  const stages = [t('reports.opens'), t('reports.signups'), t('reports.confirmed')];

  return (
    <Page title={t('reports.title')} subtitle={t('reports.subtitle')}>
      {!moneyOk ? <p className="mb-4"><Why>{t('reports.moneyHidden')}</Why></p> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-2 gap-x-4">
        {moneyOk ? (
          <ChartCard title={t('reports.sales')} subtitle={t('reports.salesSub', { total: eur(total) })}
            table={<DataTable head={[t('reports.day'), t('reports.value')]} rows={days.map((d) => [d.long, eur(d.value)])} />}>
            <ColumnChart data={days} format={eur} formatAxis={eurAxis} label={t('reports.sales')} />
          </ChartCard>
        ) : null}

        <ChartCard title={t('reports.top')} subtitle={moneyOk ? t('reports.topSubMoney') : t('reports.topSub')}
          table={<DataTable head={[t('reports.product'), t('reports.qty'), ...(moneyOk ? [t('reports.value')] : [])]} rows={(top.data ?? []).map((r) => [r.name, units(r.variantId, r.qty, r as { uom?: Uom }), ...(moneyOk && r.valueMinor != null ? [eur(r.valueMinor)] : [])])} />}>
          {/* with money visible the bars compare sales value, which works across pieces and kilos */}
          <BarList label={t('reports.top')}
            data={(top.data ?? []).map((r) => (moneyOk && r.valueMinor != null
              ? { key: r.variantId, label: r.name, value: r.valueMinor, note: t('reports.units', { n: units(r.variantId, r.qty, r as { uom?: Uom }) }) }
              : { key: r.variantId, label: r.name, value: uomOf(r.variantId, r as { uom?: Uom }) === 'piece' ? r.qty : r.qty / 1000, note: uomOf(r.variantId, r as { uom?: Uom }) === 'piece' ? undefined : t(`common:uom.${uomOf(r.variantId, r as { uom?: Uom })}`) })).sort((a, b) => b.value - a.value)}
            format={(n) => (moneyOk ? eur(n) : number(n, locale))} empty={t('reports.empty')} />
        </ChartCard>

        <ChartCard title={t('reports.wanted')} subtitle={t('reports.wantedSub')}
          table={<DataTable head={[t('reports.product'), t('reports.waiting'), t('reports.onHand')]} rows={(wanted.data ?? []).map((r) => [r.name, number(r.waiting, locale), number(r.onHand, locale)])} />}>
          <BarList label={t('reports.wanted')} data={(wanted.data ?? []).map((r) => ({ key: r.variantId, label: r.name, value: r.waiting, note: r.onHand <= 0 ? t('common:stock.out') : t('reports.onHandN', { n: number(r.onHand, locale) }) }))} format={(n) => number(n, locale)} empty={t('reports.wantedEmpty')} />
        </ChartCard>

        {links.data?.length ? (
          <ChartCard title={t('reports.links')} subtitle={t('reports.linksSub')}
            legend={<Legend items={stages.map((s, i) => ({ label: s, color: `var(--ord-${i + 1})` }))} />}
            table={<DataTable head={[t('reports.link'), ...stages, t('reports.conversion')]} rows={links.data.map((l) => [l.label ?? '', number(l.opens, locale), number(l.signups, locale), number(l.confirmed, locale), `${Math.round((l.confirmed / Math.max(1, l.opens)) * 100)}%`])} />}>
            <FunnelBars label={t('reports.links')} stages={stages} data={links.data.map((l) => ({ key: l.joinLinkId, label: l.label ?? '', values: [l.opens, l.signups, l.confirmed] }))} format={(n) => number(n, locale)} />
          </ChartCard>
        ) : null}

        <ChartCard title={t('reports.shrink')} subtitle={t('reports.shrinkSub')}
          table={<DataTable head={[t('reports.reason'), t('reports.qty'), ...(moneyOk ? [t('reports.value')] : [])]} rows={(shrink.data ?? []).map((r) => [t(`common:reason.${r.reason}`), number(r.qty, locale), ...(moneyOk && r.valueMinor != null ? [eur(r.valueMinor)] : [])])} />}>
          <BarList label={t('reports.shrink')} data={(shrink.data ?? []).sort((a, b) => b.qty - a.qty).map((r) => ({ key: r.reason, label: t(`common:reason.${r.reason}`), value: r.qty, note: moneyOk && r.valueMinor != null ? eur(r.valueMinor) : undefined }))} format={(n) => number(n, locale)} empty={t('reports.empty')} />
        </ChartCard>
      </div>
    </Page>
  );
}
