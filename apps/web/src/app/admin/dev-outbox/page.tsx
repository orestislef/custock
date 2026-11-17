'use client';

import { useState } from 'react';
import type { DevOutboxItem } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Empty, Segmented, Why } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconBell, IconMail, IconInfo } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { relative } from '@/lib/format';
import { LOCALE_NAMES, type AppLocale } from '@custock/i18n';

// development only: the emails and pushes that would have gone out. nothing leaves this machine.
export default function DevOutboxPage() {
  const { api, t, locale, org } = useAdmin();
  const toast = useToast();
  const allowed = org.orgPerms.includes('org.settings.manage');
  const [tick, setTick] = useState(0);
  const items = useAsync(() => (allowed ? api.devOutbox(200) : Promise.resolve([])), [allowed, tick]);
  const [channel, setChannel] = useState<'all' | 'push' | 'email'>('all');

  if (!allowed) return <Page title={t('outbox.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  const list = (items.data ?? []).filter((i) => channel === 'all' || i.channel === channel);
  const unavailable = Boolean(items.error);

  async function runJobs() {
    try {
      const r = await api.devRunJobs();
      toast(t('outbox.ran', { count: r.ran }));
      setTick((x) => x + 1);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Page title={t('outbox.title')} subtitle={t('outbox.lead')}
      actions={<>
        <button type="button" className="btn btn-gray" onClick={() => setTick((x) => x + 1)}>{t('outbox.refresh')}</button>
        <button type="button" className="btn btn-tinted" onClick={() => void runJobs()}>{t('outbox.run')}</button>
      </>}>
      <div className="tip mb-5"><IconInfo size={18} className="flex-none mt-0.5" /><span className="t-sub">{t('outbox.tip')}</span></div>
      <div className="mb-4"><Segmented label={t('outbox.channel')} value={channel} onChange={setChannel} options={[{ value: 'all', label: t('customers.all') }, { value: 'push', label: t('common:channel.push') }, { value: 'email', label: t('common:channel.email') }]} /></div>
      {unavailable ? <Empty icon={<IconInfo size={40} />} title={t('outbox.offTitle')} body={t('outbox.offBody')} /> :
        items.data && !list.length ? <Empty icon={<IconBell size={40} />} title={t('outbox.emptyTitle')} body={t('outbox.emptyBody')} /> : (
        <ul className="grid md:grid-cols-2 gap-3 list-none p-0 m-0">
          {list.map((i) => <OutboxCard key={i.id} item={i} locale={locale} />)}
        </ul>
      )}
    </Page>
  );
}

// pushes look like a lock screen banner, emails like an inbox row, so it is clear what customers get
function OutboxCard({ item, locale }: { item: DevOutboxItem; locale: string }) {
  const { t } = useAdmin();
  const lang = item.locale && item.locale in LOCALE_NAMES ? LOCALE_NAMES[item.locale as AppLocale] : item.locale;
  if (item.channel === 'push') {
    return (
      <li className="card p-3 flex gap-3 items-start" style={{ borderRadius: 22 }}>
        <span className="inline-grid place-items-center flex-none w-9 h-9 rounded-[9px] text-white t-display" style={{ background: 'var(--c-accent-fill)', fontWeight: 700 }}>C</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="t-foot t-2 flex-1 truncate">{item.to ? `Custock · ${item.to}` : 'Custock'}</span>
            <span className="t-cap t-3">{relative(item.createdAt, locale)}</span>
          </span>
          <span className="t-sub block" style={{ fontWeight: 600 }}>{item.title}</span>
          <span className="t-sub block line-clamp-2">{item.body}</span>
          <span className="t-cap t-3 block mt-1">{t('common:channel.push')} · {lang}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="card p-4">
      <span className="flex items-center gap-2 t-foot t-2"><IconMail size={16} />{item.to}<span className="flex-1" />{relative(item.createdAt, locale)}</span>
      <span className="t-headline block mt-1">{item.title}</span>
      <span className="t-sub t-2 block line-clamp-3 whitespace-pre-line mt-0.5">{item.body}</span>
      <span className="t-cap t-3 block mt-2">{t('common:channel.email')} · {lang}</span>
    </li>
  );
}
