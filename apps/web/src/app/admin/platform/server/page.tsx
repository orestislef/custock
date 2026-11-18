'use client';

// "This server", for the super admin: which build runs, for how long, how big the database is and
// which migrations it has, whether email and push really leave, where photos go, and whether the
// background jobs keep up. never a key or a password, only on or off and addresses. refreshes every
// 30 seconds while the page is in view.

import { useEffect, useState } from 'react';
import type { ServerInfo } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Empty, Group, Row } from '@/components/ui/kit';
import { Sheet } from '@/components/ui/client-kit';
import { IconWarning } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { dateTime, number, relative, intlLocale } from '@/lib/format';

export default function PlatformServerPage() {
  return (
    <PlatformShell>
      <Server />
    </PlatformShell>
  );
}

// in the reader's units ("740 kB", "1,1 МБ")
function mb(bytes: number, locale: string): string {
  const f = (v: number, unit: string, digits: number) => new Intl.NumberFormat(intlLocale(locale), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(v);
  if (bytes < 1024 * 1024) return f(Math.max(1, Math.round(bytes / 1024)), 'kilobyte', 0);
  return f(bytes / (1024 * 1024), 'megabyte', 1);
}

// a dot and a word, so the state never rests on colour alone
function State({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: on ? 'var(--c-success)' : 'var(--c-ink-3)' }} />
      {label}
    </span>
  );
}

function Server() {
  const { api, t, locale } = usePlatform();
  // when it was loaded travels with the answer, for the "updated ..." line
  const info = useAsync(async () => ({ server: await api.platformServer(), at: Date.now() }), []);
  const [migrationsOpen, setMigrationsOpen] = useState(false);
  const s: ServerInfo | undefined = info.data?.server;
  const at = info.data?.at ?? 0;

  // a quiet reload every 30 seconds while the page is in view
  const reload = info.reload;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const uptime = (sec: number) => {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return t('platform.dev.server.uptimeDays', { d, h });
    if (h) return t('platform.dev.server.uptimeHours', { h, m });
    return t('platform.dev.server.uptimeMinutes', { m });
  };
  const onOff = (on: boolean, host?: string | null) => <State on={on} label={on ? (host ? `${t('platform.dev.server.on')} · ${host}` : t('platform.dev.server.on')) : t('platform.dev.server.off')} />;
  const n = (v: number) => number(v, locale);

  const refresh = <button type="button" className="btn btn-gray" onClick={() => void info.reload()} disabled={info.loading}>{t('platform.dev.server.refresh')}</button>;

  return (
    <Page title={t('platform.dev.server.title')} back={{ href: '/admin/platform', label: t('platform.title') }}
      subtitle={s ? t('platform.dev.server.updated', { when: relative(at, locale) }) : t('platform.dev.server.sub')}
      actions={s ? refresh : null}
      phoneAction={s ? <button type="button" className="btn btn-plain" onClick={() => void info.reload()} disabled={info.loading}>{t('platform.dev.server.refresh')}</button> : undefined}>
      {info.error && !s ? (
        <Empty icon={<IconWarning size={28} />} title={t('platform.dev.server.loadFailed')}
          action={<button type="button" className="btn btn-tinted" onClick={() => void info.reload()}>{t('platform.dev.server.retry')}</button>} />
      ) : !s ? (
        <div className="h-96 rounded-[16px] skel" aria-busy="true" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          <div className="flex flex-col gap-6">
            <Group title={t('platform.dev.server.version')}>
              <Row chevron={false} title={t('platform.dev.server.revision')} value={<span className="font-mono">{s.build.rev ?? t('platform.dev.server.localBuild')}</span>} />
              {s.build.builtAt ? <Row chevron={false} title={t('platform.dev.server.built')} value={dateTime(Date.parse(s.build.builtAt), locale)} /> : null}
              <Row chevron={false} title={t('platform.dev.server.mode')} value={s.runtime.mode === 'production' ? t('platform.dev.server.production') : t('platform.dev.server.development')} />
              <Row chevron={false} title={t('platform.dev.server.node')} value={<span className="font-mono">{s.runtime.node}</span>} />
            </Group>

            <Group title={t('platform.dev.server.running')}>
              <Row chevron={false} title={t('platform.dev.server.started')} value={dateTime(s.runtime.startedAt, locale)} />
              <Row chevron={false} title={t('platform.dev.server.uptime')} value={uptime(s.runtime.uptimeSeconds)} />
            </Group>

            <Group title={t('platform.dev.server.database')}>
              <Row chevron={false} title={t('platform.dev.server.size')} value={mb(s.database.bytes, locale)} />
              {s.database.walBytes ? <Row chevron={false} title={t('platform.dev.server.wal')} value={mb(s.database.walBytes, locale)} /> : null}
              <Row title={t('platform.dev.server.migrations')} onClick={() => setMigrationsOpen(true)}
                subtitle={s.database.migrations.length ? `${t('platform.dev.server.lastMigration')}: ${s.database.migrations.at(-1)!.name}` : undefined}
                value={t('platform.dev.server.migrationsCount', { count: s.database.migrations.length })} />
            </Group>
          </div>

          <div className="flex flex-col gap-6">
            <Group title={t('platform.dev.server.sending')}>
              <Row chevron={false} title={t('platform.dev.server.transport')} value={<State on={s.sending.transport === 'live'} label={s.sending.transport === 'live' ? t('platform.dev.server.live') : t('platform.dev.server.outbox')} />} />
              <Row chevron={false} title={t('platform.dev.server.email')} value={onOff(s.sending.email.on, s.sending.email.host)} />
              <Row chevron={false} title={t('platform.dev.server.webpush')} value={onOff(s.sending.webpush.on)} />
              <Row chevron={false} title={t('platform.dev.server.fcm')} value={onOff(s.sending.fcm.on)} />
            </Group>

            <Group title={t('platform.dev.server.photos')}>
              <Row chevron={false} title={t('platform.dev.server.storage')}
                value={<State on={s.storage.kind !== 'off'} label={s.storage.kind === 's3' ? t('platform.dev.server.s3') : s.storage.kind === 'local' ? t('platform.dev.server.local') : t('platform.dev.server.storageOff')} />} />
              {s.storage.bucket ? <Row chevron={false} title={t('platform.dev.server.bucket')} value={<span className="font-mono">{s.storage.bucket}</span>} /> : null}
              {s.storage.host ? <Row chevron={false} title={t('platform.dev.server.bucketHost')} subtitle={<span className="code-path">{s.storage.host}</span>} /> : null}
              {s.storage.publicHost ? <Row chevron={false} title={t('platform.dev.server.publicHost')} subtitle={<span className="code-path">{s.storage.publicHost}</span>} /> : null}
            </Group>

            <Group title={t('platform.dev.server.jobs')}>
              <Row chevron={false} title={t('platform.dev.server.status')} value={<State on={s.worker.running} label={s.worker.running ? t('platform.dev.server.jobsRunning') : t('platform.dev.server.jobsStopped')} />} />
              <Row chevron={false} title={t('platform.dev.server.lastRun')} value={s.worker.lastRunAt ? relative(s.worker.lastRunAt, locale) : t('platform.dev.server.never')} />
              <Row chevron={false} title={t('platform.dev.server.queued')} value={n(s.worker.queued)} />
              <Row chevron={false} title={t('platform.dev.server.scheduled')} value={n(s.worker.scheduled)} />
              <Row chevron={false} title={t('platform.dev.server.gaveUp')} value={<span style={s.worker.failed ? { color: 'var(--c-error)' } : undefined}>{n(s.worker.failed)}</span>} />
            </Group>

            <Group title={t('platform.dev.server.last24')} footer={t('platform.dev.server.foot')}>
              <Row chevron={false} title={t('platform.dev.server.sent')} value={n(s.outbox.sent)} />
              <Row chevron={false} title={t('platform.dev.server.failed')} value={<span style={s.outbox.failed ? { color: 'var(--c-error)' } : undefined}>{n(s.outbox.failed)}</span>} />
              <Row chevron={false} title={t('platform.dev.server.waiting')} value={n(s.outbox.waiting)} />
            </Group>
          </div>
        </div>
      )}

      <Sheet open={migrationsOpen} onClose={() => setMigrationsOpen(false)} title={t('platform.dev.server.allMigrations')}>
        {s ? (
          <Group>
            {[...s.database.migrations].reverse().map((m) => (
              <Row key={m.name} chevron={false} title={<span className="font-mono">{m.name}</span>} subtitle={dateTime(m.appliedAt, locale)} />
            ))}
          </Group>
        ) : null}
      </Sheet>
    </Page>
  );
}
