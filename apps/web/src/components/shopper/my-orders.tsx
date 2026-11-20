'use client';

// the customer's orders with this business, open ones first in their own group

import Link from 'next/link';
import type { OrderSummary } from '@custock/core';
import { Empty } from '@/components/ui/kit';
import { IconBag, IconChevronRight } from '@/components/ui/icons';
import { MoreRows } from '@/components/ui/more-rows';
import { OrderStatusBadge } from '@/components/orders/order-bits';
import { displayTimeZone, money, relative } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';
import { dayText, OPEN_STATUSES } from '@/lib/order-format';
import { usePaged } from '@/lib/use-paged';
import { SignInCard } from './sign-in';
import { useShopper } from './shopper-context';

export function OrderRowLink({ o, href }: { o: OrderSummary; href: string }) {
  const t = useT();
  const locale = useLocale();
  const wanted = dayText(o.wantedOn, locale, displayTimeZone());
  return (
    <Link href={href} className="row has-icon hover:no-underline" style={{ color: 'var(--c-ink)', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
      <span className="icon-tile"><IconBag size={18} /></span>
      <span className="row-main min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="row-title">#{o.number}</span>
          <OrderStatusBadge status={o.status} side="customer" />
        </span>
        <span className="row-sub block truncate">{o.names.join(', ')}{o.lineCount > o.names.length ? ` +${o.lineCount - o.names.length}` : ''}</span>
        <span className="row-sub block">
          {o.shopName} · {wanted ? t('orders.forDay', { day: wanted }) : relative(o.createdAt, locale)}
        </span>
      </span>
      <span className="t-body tnum flex-none">{o.totalMinor != null ? money(o.totalMinor, o.currency, locale) : ''}</span>
      <IconChevronRight size={16} className="chev" />
    </Link>
  );
}

export function MyOrders() {
  const t = useT();
  const { api, slug, status } = useShopper();
  const list = usePaged((cursor) => (status === 'signedIn' ? api.myOrders(slug, { cursor }) : Promise.resolve({ items: [], nextCursor: null })), [slug, status], { refreshOnReturn: true });
  if (status === 'loading') return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (status === 'signedOut') return <SignInCard />;
  const items = list.items ?? [];
  if (list.data && !items.length) {
    return <Empty icon={<IconBag size={40} />} title={t('orders.noneTitle')} body={t('orders.noneBody')} action={<Link href={`/s/${slug}`} className="btn btn-tinted">{t('orders.browse')}</Link>} />;
  }
  const open = items.filter((o) => OPEN_STATUSES.includes(o.status));
  const done = items.filter((o) => !OPEN_STATUSES.includes(o.status));
  return (
    <>
      {open.length ? (
        <section className="inset-group">
          <h2 className="inset-group-head">{t('orders.openHead')}</h2>
          <ul className="list" role="list">{open.map((o) => <li key={o.id}><OrderRowLink o={o} href={`/s/${slug}/orders/${o.id}`} /></li>)}</ul>
        </section>
      ) : null}
      {done.length ? (
        <section className="inset-group">
          <h2 className="inset-group-head">{t('orders.doneHead')}</h2>
          <ul className="list" role="list">{done.map((o) => <li key={o.id}><OrderRowLink o={o} href={`/s/${slug}/orders/${o.id}`} /></li>)}</ul>
        </section>
      ) : null}
      {!list.data ? <div className="h-40 rounded-[16px] skel" aria-busy="true" /> : null}
      <MoreRows {...list.more} className="flex justify-center py-5" />
    </>
  );
}
