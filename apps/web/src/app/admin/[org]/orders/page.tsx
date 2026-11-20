'use client';

// orders from customers for the shops this person sees (thinking/19-orders.md): what is new first,
// then what waits for the customer, what to prepare and what is ready to hand over

import Link from '@/components/admin/org-link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrgRouter as useRouter } from '@/components/admin/org-link';
import type { OrderListStatus, OrderSummary } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { RedirectHome } from '@/components/admin/redirect-home';
import { Chips, Empty } from '@/components/ui/kit';
import { IconBag, IconChevronRight } from '@/components/ui/icons';
import { MoreRows } from '@/components/ui/more-rows';
import { OrderStatusBadge } from '@/components/orders/order-bits';
import { displayTimeZone, money, relative } from '@/lib/format';
import { dayText } from '@/lib/order-format';
import { usePaged } from '@/lib/use-paged';

type F = 'requested' | 'quoted' | 'confirmed' | 'ready' | 'closed' | 'all';
const FILTERS: F[] = ['requested', 'quoted', 'confirmed', 'ready', 'closed', 'all'];

export default function OrdersPage() {
  return <Suspense><Orders /></Suspense>;
}

function OrderRow({ o }: { o: OrderSummary }) {
  const { t, locale } = useAdmin();
  const wanted = dayText(o.wantedOn, locale, displayTimeZone());
  return (
    <Link href={`/admin/orders/${o.id}`} className="row has-icon hover:no-underline" style={{ color: 'var(--c-ink)', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
      <span className="icon-tile"><IconBag size={18} /></span>
      <span className="row-main min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="row-title">#{o.number}</span>
          <span className="row-title truncate">{o.customerName ?? t('orders.erasedCustomer')}</span>
          <OrderStatusBadge status={o.status} side="staff" />
        </span>
        <span className="row-sub block truncate">{o.names.join(', ')}{o.lineCount > o.names.length ? ` +${o.lineCount - o.names.length}` : ''}</span>
        <span className="row-sub block">
          {o.shopName}
          {wanted ? ` · ${t('orders.forDay', { day: wanted })}` : ''}
          {` · ${relative(o.createdAt, locale)}`}
        </span>
      </span>
      <span className="t-body tnum flex-none">{o.totalMinor != null ? money(o.totalMinor, o.currency, locale) : <span className="t-2 t-sub">{t('orders.noPriceYet')}</span>}</span>
      <IconChevronRight size={16} className="chev" />
    </Link>
  );
}

function Orders() {
  const { api, org, t, can, shopId } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState<F>(FILTERS.includes(params.get('status') as F) ? (params.get('status') as F) : 'requested');
  const status: OrderListStatus | undefined = f === 'all' ? undefined : f;
  const list = usePaged((cursor) => api.orders(org.orgId, { status, shopId: shopId ?? undefined, cursor }), [f, shopId], { refreshOnReturn: true });
  const items = list.items ?? [];
  if (!org.shops.some((s) => can('orders.view', s.shopId)) && !can('orders.view', null)) return <RedirectHome />;

  return (
    <Page title={t('orders.staffTitle')}>
      <div className="mb-5 overflow-x-auto">
        <Chips label={t('orders.filter')} value={f} onChange={(v) => { setF(v); router.replace(v === 'requested' ? '/admin/orders' : `/admin/orders?status=${v}`); }}
          options={FILTERS.map((v) => ({ value: v, label: t(`orders.filters.${v}`) }))} />
      </div>
      {list.data && !items.length ? (
        <Empty icon={<IconBag size={40} />} title={t(`orders.emptyStaff.${f}`)} body={f === 'requested' ? t('orders.emptyStaffBody') : undefined} />
      ) : !list.data ? (
        <div className="h-40 rounded-[16px] skel" aria-busy="true" />
      ) : (
        <ul className="list" role="list">{items.map((o) => <li key={o.id}><OrderRow o={o} /></li>)}</ul>
      )}
      <MoreRows {...list.more} className="flex justify-center py-5" />
    </Page>
  );
}
