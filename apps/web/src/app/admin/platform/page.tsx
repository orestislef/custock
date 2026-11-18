'use client';

// all businesses, for a super admin: the numbers across the platform, the photo storage free
// tier, the emergency switches, every business with its owner, and the other super admins.

import { useMemo, useState } from 'react';
import type { PlatformSettings, PlatformSwitch } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Meter, Stat, bytes, moneyList } from '@/components/platform/bits';
import { NewBusinessSheet } from '@/components/platform/new-business-sheet';
import { SuperAdminsSection } from '@/components/platform/super-admins';
import { Empty, Group, Row, Switch } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconGear, IconHistory, IconLink, IconPlus, IconSearch, IconShop } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { useHashScroll } from '@/lib/use-hash-scroll';
import { ErrorsNavRow } from './errors/nav-row';
import { PushCard } from '@/components/pwa/push-card';
import { AppIcon } from '@/components/pwa/install-coach';
import { basePath } from '@/lib/api-client';
import { number } from '@/lib/format';

const SWITCHES: PlatformSwitch[] = ['pause_email', 'pause_push', 'pause_signups', 'pause_invites'];

export default function PlatformPage() {
  return (
    <PlatformShell>
      <PlatformHome />
    </PlatformShell>
  );
}

function PlatformHome() {
  const { api, t, locale, refresh } = usePlatform();
  const toast = useToast();
  const overview = useAsync(() => api.platformOverview(), []);
  const businesses = useAsync(() => api.platformBusinesses(), []);
  const settings = useAsync(() => api.platformSettings(), []);
  // a storage alert opens #storage
  useHashScroll(!!overview.data);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ key: keyof PlatformSettings; on: boolean } | null>(null);
  const o = overview.data;

  const list = useMemo(() => {
    const all = businesses.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((b) => [b.name, b.slug, ...b.owners.map((x) => `${x.name ?? ''} ${x.email ?? ''}`), ...b.pendingOwnerInvites.map((i) => i.email)].join(' ').toLowerCase().includes(needle));
  }, [businesses.data, q]);

  const apply = async (key: keyof PlatformSettings, on: boolean) => {
    try {
      settings.setData(await api.setPlatformSettings({ [key]: on }));
      await refresh();
      void overview.reload();
      toast(on ? t('platform.switch.nowOn') : t('platform.switch.nowOff'));
    } catch {
      toast(t('common:error.internal'));
    }
  };

  const nf = (n: number) => number(n, locale);

  return (
    <Page title={t('platform.title')} subtitle={t('platform.subtitle')}
      actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><IconPlus size={18} />{t('platform.newBusiness')}</button>}
      phoneAction={<button type="button" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('platform.newBusiness')} onClick={() => setCreating(true)}><IconPlus size={22} /></button>}>

      <PushCard api={api} orgId={null} place="platform-home" className="mb-6 max-w-[640px]"
        title={t('push.card.platformTitle')} body={t('push.card.platformBody')} later={t('push.card.platformLater')}
        onTitle={t('push.card.platformOnTitle')} onBody={t('push.card.platformOnBody')}
        appName="Custock" appIcon={<AppIcon src={`${basePath}/icons/icon-192.png`} size={44} label="Custock" />} />

      {/* the numbers across every business */}
      <section aria-label={t('platform.overview')} className="mb-8">
        {o ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <Stat label={t('platform.stat.businesses')} value={nf(o.businesses)} sub={o.suspended ? t('platform.stat.paused', { count: o.suspended }) : undefined} />
            <Stat label={t('platform.stat.shops')} value={nf(o.shops)} />
            <Stat label={t('platform.stat.staff')} value={nf(o.staff)} />
            <Stat label={t('platform.stat.customers')} value={nf(o.customers)} sub={t('platform.stat.confirmed')} />
            <Stat label={t('platform.stat.products')} value={nf(o.products)} />
            <Stat label={t('platform.stat.salesToday')} value={moneyList(o.salesToday, locale)} />
            <Stat label={t('platform.stat.sales14d')} value={moneyList(o.sales14d, locale)} />
            <Stat label={t('platform.stat.emails')} value={nf(o.emailsSent14d)} sub={t('platform.stat.last14')} />
            <Stat label={t('platform.stat.pushes')} value={nf(o.pushesSent14d)} sub={t('platform.stat.last14')} />
            <Stat label={t('platform.stat.invites')} value={nf(o.pendingInvites)} sub={t('platform.stat.pending')} />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3" aria-busy="true">
            {Array.from({ length: 10 }, (_, i) => <div key={i} className="h-[92px] rounded-[16px] skel" />)}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px] items-start">
        <div className="min-w-0">
          {/* every business */}
          <h2 className="t-title3 m-0 mb-3">{t('platform.businesses')}</h2>
          <label className="search mb-3 flex items-center gap-2 px-3 rounded-[10px]" style={{ background: 'var(--c-fill)', minHeight: 40 }}>
            <IconSearch size={18} className="t-2" />
            <span className="sr-only">{t('platform.search')}</span>
            <input className="flex-1 bg-transparent border-0 outline-none t-body" style={{ fontSize: 16 }} placeholder={t('platform.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {businesses.data && !businesses.data.length ? (
            <Empty icon={<IconShop size={28} />} title={t('platform.emptyTitle')} body={t('platform.emptyBody')}
              action={<button type="button" className="btn btn-tinted" onClick={() => setCreating(true)}>{t('platform.newBusiness')}</button>} />
          ) : !businesses.data ? (
            <div className="h-48 rounded-[16px] skel" aria-busy="true" />
          ) : !list.length ? (
            <p className="t-sub t-2 px-4">{t('platform.noMatch')}</p>
          ) : (
            <Group>
              {list.map((b) => {
                const owner = b.owners[0];
                const pending = b.pendingOwnerInvites.find((i) => !i.expired);
                return (
                  <Row key={b.orgId} href={`/admin/platform/${b.orgId}`}
                    leading={<span className="icon-tile"><IconShop size={18} /></span>}
                    title={<span className="inline-flex items-center gap-2 min-w-0"><span className="truncate">{b.name}</span>{b.status === 'suspended' ? <span className="badge badge-neg">{t('platform.pausedBadge')}</span> : null}</span>}
                    subtitle={[
                      owner ? (owner.name ?? owner.email) : pending ? t('platform.ownerInvited', { email: pending.email }) : t('platform.noOwner'),
                      t('platform.countsLine', { shops: b.counts.shops, staff: b.counts.staff, customers: b.counts.customers }),
                      bytes(b.storageBytes, locale),
                    ].join(' · ')} />
                );
              })}
            </Group>
          )}

          <div className="mt-8"><SuperAdminsSection /></div>
        </div>

        <div className="min-w-0 flex flex-col gap-8">
          {/* photo storage against its free tier */}
          <section id="storage" aria-labelledby="storage-h">
            <h2 id="storage-h" className="t-title3 m-0 mb-3">{t('platform.storage.title')}</h2>
            <div className="card p-4 flex flex-col gap-4">
              {o ? (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between gap-2 t-sub"><span>{t('platform.storage.stored')}</span><span className="tnum t-2">{bytes(o.storage.bytesUsed, locale)} / {bytes(o.storage.bytesFree, locale)}</span></div>
                    <Meter percent={(o.storage.bytesUsed / o.storage.bytesFree) * 100} label={t('platform.storage.stored')} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between gap-2 t-sub"><span>{t('platform.storage.uploads')}</span><span className="tnum t-2">{nf(o.storage.writesThisMonth)} / {nf(o.storage.writesFree)}</span></div>
                    <Meter percent={(o.storage.writesThisMonth / o.storage.writesFree) * 100} label={t('platform.storage.uploads')} />
                  </div>
                  <p className="t-foot t-2 m-0">{t('platform.storage.reads')}</p>
                </>
              ) : <div className="h-28 rounded-[12px] skel" aria-busy="true" />}
            </div>
            {settings.data ? (
              <Group className="mt-3" footer={t('platform.storage.stopFoot', { pct: o?.storage.stopPercent ?? 95 })}>
                <Row title={t('platform.storage.stop')} chevron={false}
                  trailing={<Switch label={t('platform.storage.stop')} checked={settings.data.uploads_stop_at_free} onChange={(v) => void apply('uploads_stop_at_free', v)} />} />
              </Group>
            ) : null}
          </section>

          {/* the emergency switches */}
          <section id="switches" aria-labelledby="switches-h">
            <h2 id="switches-h" className="t-title3 m-0 mb-1">{t('platform.switch.title')}</h2>
            <p className="t-sub t-2 m-0 mb-3">{t('platform.switch.lead')}</p>
            {settings.data ? (
              <Group>
                {SWITCHES.map((k) => (
                  <Row key={k} chevron={false} title={t(`platform.switch.${k}.title`)} subtitle={t(`platform.switch.${k}.sub`)}
                    trailing={<Switch label={t(`platform.switch.${k}.title`)} checked={settings.data![k]}
                      onChange={(v) => (v ? setConfirm({ key: k, on: true }) : void apply(k, false))} />} />
                ))}
              </Group>
            ) : <div className="h-48 rounded-[16px] skel" aria-busy="true" />}
          </section>

          <Group>
            <Row href="/admin/platform/audit" leading={<span className="icon-tile"><IconHistory size={18} /></span>} title={t('platform.audit.title')} subtitle={t('platform.audit.sub')} />
            <ErrorsNavRow />
          </Group>

          <Group>
            <Row href="/admin/platform/policies" leading={<span className="icon-tile"><IconGear size={18} /></span>} title={t('platform.policies.title')} subtitle={t('platform.policies.sub')} />
          </Group>

          <Group title={t('platform.dev.title')}>
            <Row href="/admin/platform/api" leading={<span className="icon-tile"><IconLink size={18} /></span>} title={t('platform.dev.api.title')} subtitle={t('platform.dev.api.sub')} />
            <Row href="/admin/platform/server" leading={<span className="icon-tile"><IconGear size={18} /></span>} title={t('platform.dev.server.title')} subtitle={t('platform.dev.server.sub')} />
          </Group>
        </div>
      </div>

      <NewBusinessSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { void businesses.reload(); void overview.reload(); }} />

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? t(`platform.switch.${confirm.key}.title`) : ''}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setConfirm(null)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-danger-fill" onClick={() => { const c = confirm!; setConfirm(null); void apply(c.key, true); }}>{t('platform.switch.confirm')}</button>
        </>}>
        {confirm ? <p className="t-body m-0">{t(`platform.switch.${confirm.key}.confirm`)}</p> : null}
      </Sheet>
    </Page>
  );
}

