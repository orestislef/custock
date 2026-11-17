'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Tally } from '@/components/ui/tally';
import { Tip } from '@/components/ui/client-kit';
import { Group, Row, IconTile } from '@/components/ui/kit';
import { IconBarcode, IconBell, IconBox, IconCheck, IconHalf, IconPeople, IconSlash, IconTruck, IconWarning, IconCalendar, IconMegaphone } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { date, money, relative } from '@/lib/format';

export default function Dashboard() {
  const { api, org, t, locale, can, me, shops } = useAdmin();
  const shopId = useShopFilter();
  const cards = useAsync(() => api.dashboard(org.orgId, shopId), [shopId]);
  const recent = useAsync(() => (can('stock.history.view') ? api.movements(org.orgId, { shopId, limit: 6 }) : Promise.resolve(null)), [shopId]);
  const products = useAsync(() => api.products(org.orgId, { limit: 200 }), []);
  const d = cards.data;
  const [now] = useState(Date.now);
  const first = me.user.displayName?.split(' ')[0] ?? '';
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '';
  const variantName = (id: string) => products.data?.items.find((p) => p.variants.some((v) => v.id === id))?.name ?? '';

  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Athens' }).format(now));
  const greeting = t(hour < 12 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening', { name: first });

  const stat = (key: string, value: number | null | undefined, href: string, icon: React.ReactNode, tone?: string, fmt?: (n: number) => string) =>
    value == null ? null : (
      <Link key={key} href={href} className="card p-4 hover:no-underline block" style={{ color: 'var(--c-ink)' }}>
        <span className="flex items-center gap-2 t-foot t-2">{icon}{t(`dash.${key}`)}</span>
        <span className="block mt-2 t-title1 t-display tnum" style={{ color: tone }}>
          {d ? <Tally value={value} format={fmt} /> : <span className="inline-block w-12 h-7 skel" />}
        </span>
      </Link>
    );

  const needs = d
    ? [
        can('posts.publish', null) && d.pendingApprovals > 0 && { key: 'approvals', n: d.pendingApprovals, href: '/admin/posts?status=pending_approval', icon: <IconMegaphone size={18} /> },
        can('stock.count.approve', null) && d.countsInReview > 0 && { key: 'counts', n: d.countsInReview, href: '/admin/stock', icon: <IconCheck size={18} /> },
        (can('products.create', null) || can('products.edit', null)) && d.unknownCodes > 0 && { key: 'unknown', n: d.unknownCodes, href: '/admin/stock?filter=unknown', icon: <IconBarcode size={18} /> },
        can('stock.adjust', null) && d.negativeStock > 0 && { key: 'negative', n: d.negativeStock, href: '/admin/stock?filter=negative', icon: <IconWarning size={18} /> },
        d.transfersOnTheWay > 0 && { key: 'transfers', n: d.transfersOnTheWay, href: '/admin/stock', icon: <IconTruck size={18} /> },
      ].filter(Boolean) as { key: string; n: number; href: string; icon: React.ReactNode }[]
    : [];

  return (
    <Page title={greeting} subtitle={date(now, locale, { weekday: 'long', day: 'numeric', month: 'long' })}>
      {can('joinlinks.manage', null) ? <Tip id="dash-qr">{t('dash.tipQr')}</Tip> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {stat('salesToday', can('reports.financial.view', null) ? d?.salesTodayMinor ?? 0 : null, '/admin/reports', <IconCalendar size={16} />, undefined, (n) => money(n, org.currency, locale))}
        {stat('stockValue', can('reports.financial.view', null) ? d?.stockValueCostMinor ?? 0 : null, '/admin/reports', <IconBox size={16} />, undefined, (n) => money(n, org.currency, locale))}
        {stat('waiting', d?.peopleWaiting ?? 0, '/admin/stock?filter=waiting', <IconBell size={16} />, 'var(--c-accent)')}
        {stat('lowStock', d?.lowStock ?? 0, '/admin/stock?filter=low', <IconHalf size={16} />, d?.lowStock ? 'var(--c-few-text)' : undefined)}
        {stat('outOfStock', d?.outOfStock ?? 0, '/admin/stock?filter=out', <IconSlash size={16} />)}
        {stat('newFollowers', can('customers.view', null) ? d?.newFollowersWeek ?? 0 : null, '/admin/customers', <IconPeople size={16} />)}
        {stat('scheduled', can('posts.view', null) ? d?.scheduledPosts ?? 0 : null, '/admin/posts?status=scheduled', <IconMegaphone size={16} />)}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-x-6">
        <Group title={t('dash.needsYou')} footer={needs.length ? undefined : t('dash.allClear')}>
          {needs.length ? needs.map((n) => (
            <Row key={n.key} href={n.href} leading={<IconTile>{n.icon}</IconTile>} title={t(`dash.need.${n.key}`, { count: n.n })} value={n.n} />
          )) : <Row leading={<IconTile color="var(--c-success)"><IconCheck size={18} /></IconTile>} title={t('dash.nothing')} />}
        </Group>

        {recent.data ? (
          <Group title={t('dash.recent')} footer={<Link href="/admin/stock">{t('common:action.seeAll')}</Link>}>
            {recent.data.items.map((m) => (
              <Row
                key={m.id}
                title={variantName(m.variantId) || t(`common:movement.${m.kind}`)}
                subtitle={`${t(`common:movement.${m.kind}`)} · ${shopName(m.shopId)} · ${m.createdByName ?? ''} · ${relative(m.recordedAt, locale)}`}
                value={<span style={{ color: m.qtyDelta > 0 ? 'var(--c-success)' : 'var(--c-ink-2)' }}>{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</span>}
              />
            ))}
          </Group>
        ) : null}
      </div>
    </Page>
  );
}
