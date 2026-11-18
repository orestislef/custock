'use client';

// "3 not synced yet": stock changes made without signal that wait on this device. tapping it shows
// what waits and what the server refused, with the reason, and a way to send now.

import { useState } from 'react';
import { useAdmin } from './admin-context';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { Group, Row } from '@/components/ui/kit';
import { IconClock, IconWarning, IconWifiOff } from '@/components/ui/icons';
import { dateTime } from '@/lib/format';
import { discardRejected, flush, useOnline, useOutbox } from '@/lib/outbox';

export function OutboxBadge({ dark }: { dark?: boolean }) {
  const { t } = useAdmin();
  const { queued, rejected } = useOutbox();
  const [open, setOpen] = useState(false);
  if (!queued && !rejected.length) return null;
  const refused = rejected.length > 0;
  const label = refused ? t('offline.rejectedBadge', { count: rejected.length }) : t('offline.badge', { count: queued });
  const style = dark ? undefined : { background: refused ? 'var(--c-neg-tint)' : 'var(--c-few-tint)', color: refused ? 'var(--c-neg-text)' : 'var(--c-few-text)' };
  return (
    <>
      <button type="button" className={dark ? 'scan-pill' : 'badge'} style={{ ...style, cursor: 'pointer', border: 0, minHeight: dark ? 36 : 32 }} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {refused ? <IconWarning size={14} /> : <IconClock size={14} />}
        {label}
      </button>
      <OutboxSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function OutboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, api, locale } = useAdmin();
  const toast = useToast();
  const online = useOnline();
  const { rows, queued, rejected } = useOutbox();
  const [busy, setBusy] = useState(false);
  const waiting = rows.filter((r) => r.status === 'queued');
  const line = (r: (typeof rows)[number]) => {
    const kind = t(`common:movement.${r.payload.kind}`);
    const qty = r.payload.qtyDelta > 0 ? `+${r.payload.qtyDelta}` : `−${Math.abs(r.payload.qtyDelta)}`;
    return { title: `${kind} ${qty}`, sub: dateTime(r.createdAt, locale) };
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('offline.title')}
      footer={
        <div className="flex flex-col gap-2 pb-2">
          {queued ? (
            <button type="button" className="btn btn-primary btn-large" disabled={!online || busy}
              onClick={() => { setBusy(true); void flush(api).then((n) => { if (n) toast(t('offline.synced', { count: n })); }).catch(() => {}).finally(() => setBusy(false)); }}>
              {t('offline.retry')}
            </button>
          ) : null}
          {rejected.length ? (
            <button type="button" className="btn btn-gray btn-large" style={{ color: 'var(--c-error)' }} onClick={() => void discardRejected(rejected.map((r) => r.id))}>{t('offline.discard')}</button>
          ) : null}
        </div>
      }>
      <p className="t-sub t-2 mt-0 mb-4 flex gap-2 items-start">
        {!online ? <IconWifiOff size={18} className="flex-none mt-0.5" /> : null}
        {online ? t('offline.onlineBody') : t('offline.offlineBody')}
      </p>
      {waiting.length ? (
        <Group title={t('offline.waiting', { count: waiting.length })}>
          {waiting.slice(0, 30).map((r) => { const l = line(r); return <Row key={r.id} title={l.title} subtitle={l.sub} leading={<span className="icon-tile"><IconClock size={18} /></span>} />; })}
        </Group>
      ) : null}
      {rejected.length ? (
        <Group title={t('offline.refused', { count: rejected.length })} footer={t('offline.refusedFooter')}>
          {rejected.map((r) => { const l = line(r); return <Row key={r.id} title={l.title} subtitle={`${l.sub} · ${t(`common:error.${r.reason ?? 'internal'}`)}`} leading={<span className="icon-tile neg"><IconWarning size={18} /></span>} />; })}
        </Group>
      ) : null}
      {!waiting.length && !rejected.length ? <p className="t-body m-0 mb-4">{t('offline.allSynced')}</p> : null}
    </Sheet>
  );
}
