'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdmin, useShopFilter } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Empty, Segmented, Why } from '@/components/ui/kit';
import { IconBell, IconMail, IconPeople, IconSearch } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { LOCALE_NAMES } from '@custock/i18n';

type Channel = 'all' | 'email' | 'push';

export default function CustomersPage() {
  const { api, org, t, can } = useAdmin();
  const shopId = useShopFilter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [channel, setChannel] = useState<Channel>('all');
  useEffect(() => { const id = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(id); }, [q]);

  const list = useAsync(() => api.customers(org.orgId, { q: debounced || undefined, shopId, channel: channel === 'all' ? undefined : channel, limit: 200 }), [debounced, shopId, channel]);
  const items = list.data?.items ?? [];
  const masked = items.some((c) => c.contactMasked);

  if (!can('customers.view', null)) {
    return <Page title={t('customers.title')}><Empty icon={<IconPeople size={40} />} title={t('customers.noAccess')} body={t('common:error.forbidden')} /></Page>;
  }

  return (
    <Page title={t('customers.title')} subtitle={list.data ? t('customers.count', { count: items.length }) : undefined}>
      <div className="flex flex-col gap-3 mb-5">
        <div className="search">
          <IconSearch size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} />
        </div>
        <div><Segmented label={t('customers.channel')} value={channel} onChange={setChannel} options={[{ value: 'all', label: t('customers.all') }, { value: 'email', label: t('common:channel.email') }, { value: 'push', label: t('common:channel.push') }]} /></div>
      </div>

      {list.data && !items.length ? (
        <Empty icon={<IconPeople size={40} />} title={debounced ? t('customers.noResults') : t('customers.emptyTitle')} body={debounced ? undefined : t('customers.emptyBody')}
          action={!debounced && can('joinlinks.manage', null) ? <Link className="btn btn-tinted" href="/admin/join-links">{t('customers.printQr')}</Link> : undefined} />
      ) : (
        <section className="group">
          <div className="list">
            {items.map((c) => (
              <Link key={c.id} href={`/admin/customers/${c.id}`} className="row has-icon" style={{ '--sep-inset': '64px' } as React.CSSProperties}>
                <Avatar name={c.name} />
                <span className="row-main">
                  <span className="row-title block">{c.name}</span>
                  <span className="row-sub block truncate">{c.email} · {LOCALE_NAMES[c.locale]}</span>
                  {c.tags.length ? (
                    <span className="flex gap-1.5 flex-wrap mt-1">{c.tags.map((tag) => <span key={tag} className="badge badge-gray">{tag}</span>)}</span>
                  ) : null}
                </span>
                <span className="flex gap-1.5" style={{ color: 'var(--c-ink-3)' }}>
                  <span title={t('common:channel.email')} style={{ color: c.emailOk ? 'var(--c-ink-2)' : 'var(--c-line)' }}><IconMail size={18} aria-label={c.emailOk ? t('customers.emailOn') : t('customers.emailOff')} /></span>
                  <span title={t('common:channel.push')} style={{ color: c.pushOk ? 'var(--c-ink-2)' : 'var(--c-line)' }}><IconBell size={18} aria-label={c.pushOk ? t('customers.pushOn') : t('customers.pushOff')} /></span>
                </span>
              </Link>
            ))}
            {!list.data ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row"><span className="w-9 h-9 rounded-full skel" /><span className="row-main"><span className="block h-4 w-1/2 skel" /><span className="block h-3 w-2/3 skel mt-2" /></span></div>
            )) : null}
          </div>
          {masked ? <p className="group-foot"><Why>{t('customers.maskedWhy')}</Why></p> : null}
        </section>
      )}
    </Page>
  );
}
