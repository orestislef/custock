'use client';

import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { BarList, ChartCard, ColumnChart, DataTable, FunnelBars, Legend } from '@/components/admin/charts';
import { Group, Row } from '@/components/ui/kit';
import { useAsync } from '@/lib/use-async';
import { date, money, number, qtyNumber, intlLocale } from '@/lib/format';
import type { Uom } from '@custock/core';
import { RedirectHome } from '@/components/admin/redirect-home';

export default function ReportsPage() {
  const { api, org, t, locale, can } = useAdmin();
  const shopId = useShopFilter();
  const moneyOk = can('reports.financial.view', shopId ?? null);
  const allowed = can('reports.view', shopId ?? null);
  const none = <T,>(v: T) => Promise.resolve(v);
  const sales = useAsync(() => (allowed && moneyOk ? api.salesSeries(org.orgId, shopId, 14) : none([])), [shopId, allowed], { refreshOnReturn: true });
  const top = useAsync(() => (allowed ? api.topSellers(org.orgId, shopId, 14) : none([])), [shopId, allowed], { refreshOnReturn: true });
  const wanted = useAsync(() => (allowed ? api.mostWanted(org.orgId, shopId) : none([])), [shopId, allowed], { refreshOnReturn: true });
  const links = useAsync(() => (allowed && can('customers.view', null) && org.orgPerms.includes('reports.view') ? api.joinLinkStats(org.orgId) : none([])), [allowed]);
  // top sellers carry their unit; the page no longer downloads 200 whole products to look it up
  const uomOf = (_variantId: string, row?: { uom?: Uom }): Uom => row?.uom ?? 'piece';
  const units = (variantId: string, qty: number, row?: { uom?: Uom }) => { const u = uomOf(variantId, row); return u === 'piece' ? number(qty, locale) : `${qtyNumber(qty, u, locale)} ${t(`common:uom.${u}`)}`; };
  const cards = useAsync(() => (allowed && moneyOk ? api.dashboard(org.orgId, shopId) : Promise.resolve(null)), [shopId, allowed], { refreshOnReturn: true });
  const shrink = useAsync(() => (allowed ? api.shrinkage(org.orgId, shopId, 30) : none([])), [shopId, allowed], { refreshOnReturn: true });

  if (!allowed) return <RedirectHome />;

  const eur = (n: number) => money(n, org.currency, locale);
  // the same currency style as every other amount, whole units on the axis
  const eurAxis = (n: number) => new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: org.currency, maximumFractionDigits: 0 }).format(n / 100);
  const days = (sales.data ?? []).map((p) => {
    const ms = new Date(`${p.day}T12:00:00Z`).getTime();
    return { key: p.day, label: date(ms, locale, { day: 'numeric' }), long: date(ms, locale, { weekday: 'long', day: 'numeric', month: 'long' }), value: p.value };
  });
  const total = days.reduce((a, d) => a + d.value, 0);
  const stages = [t('reports.opens'), t('reports.signups'), t('reports.confirmed')];

  return (
    <Page title={t('reports.title')} subtitle={t('reports.subtitle')}>
      {moneyOk && cards.data ? (
        <Group>
          <Row title={t('dash.stockValue')} value={<span className="t-headline" style={{ color: 'var(--c-ink)' }}>{eur(cards.data.stockValueCostMinor ?? 0)}</span>} />
          <Row title={t('dash.salesToday')} value={<span className="t-headline" style={{ color: 'var(--c-ink)' }}>{eur(cards.data.salesTodayMinor ?? 0)}</span>} />
        </Group>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-2 gap-x-4 items-start">
        {moneyOk ? (
          <ChartCard title={t('reports.sales')} subtitle={t('reports.salesSub', { total: eur(total) })}
            table={<DataTable head={[t('reports.day'), t('reports.value')]} rows={days.map((d) => [d.long, eur(d.value)])} />}>
            <ColumnChart data={days} format={eur} formatAxis={eurAxis} label={t('reports.sales')} empty={t('reports.noSales')} />
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
