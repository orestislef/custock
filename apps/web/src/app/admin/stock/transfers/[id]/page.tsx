'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { Transfer } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Group, Row, StockBadge } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconChevronLeft } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { StaffMissing, missingFrom } from '@/components/ui/gone';
import { dateTime, number } from '@/lib/format';

// send, on the way, receive. what did not arrive is lost in transit and shows in shrinkage.
export default function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const tr = useAsync(() => api.transfer(org.orgId, id), [id]);
  const allShops = useAsync(() => api.shops(org.orgId, { all: true }), []);
  const [got, setGot] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const x = tr.data;
  const missing = missingFrom(tr.error);
  if (!x && missing) return <StaffMissing kind={missing} title={t('gone.transfer.title')} body={t('gone.transfer.body')} href="/admin/stock/transfers" cta={t('gone.transfer.cta')} />;
  if (!x) return <div className="pt-6"><div className="h-40 skel" /></div>;

  const name = (sid: string) => (allShops.data ?? shops).find((s) => s.id === sid)?.name ?? (sid === x?.fromShopId ? x?.fromShopName : sid === x?.toShopId ? x?.toShopName : undefined) ?? '';
  const canSend = x.status === 'draft' && can('stock.transfer.send', x.fromShopId);
  const canReceive = x.status === 'sent' && can('stock.transfer.receive', x.toShopId);
  const received = (variantId: string, sent: number) => got[variantId] ?? sent;
  const short = x.lines.reduce((a, l) => a + Math.max(0, l.qtySent - received(l.variantId, l.qtySent)), 0);

  async function run(fn: () => Promise<Transfer>, msg: string) {
    setBusy(true);
    try { tr.setData(await fn()); toast(msg); } catch (e) { toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`)); } finally { setBusy(false); }
  }

  return (
    <div className="page-in pt-2 max-w-[760px]">
      <Link href="/admin/stock/transfers" className="inline-flex items-center min-h-[44px] -ml-2 t-body"><IconChevronLeft size={24} />{t('transfers.title')}</Link>
      <p className="t-sub t-2 m-0 mt-2">{t(`transfers.status.${x.status}`)}{x.sentAt ? ` · ${dateTime(x.sentAt, locale)}` : ''}</p>
      <h1 className="t-title1 t-display m-0 mt-1">{name(x.fromShopId)} → {name(x.toShopId)}</h1>
      {x.note ? <p className="t-body t-2 mt-2 mb-0">{x.note}</p> : null}
      <div className="h-6" />

      <Group title={t('transfers.lines')} footer={canReceive ? t('transfers.receiveFoot') : x.status === 'received' ? t('transfers.lostFoot') : undefined}>
        {x.lines.map((l) => (
          <Row key={l.variantId} title={l.name}
            subtitle={
              x.status === 'received'
                ? <span className="inline-flex gap-2 items-center flex-wrap">{t('transfers.sentGot', { sent: number(l.qtySent, locale), got: number(l.qtyReceived ?? 0, locale) })}{l.lost > 0 ? <StockBadge state="negative" label={t('transfers.lost', { n: number(l.lost, locale) })} /> : null}</span>
                : canReceive ? t('transfers.sentN', { n: number(l.qtySent, locale) }) : undefined
            }
            trailing={canReceive ? (
              <input className="t-title3 tnum text-right bg-transparent border-0 outline-none w-20 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }} inputMode="numeric"
                aria-label={t('transfers.gotFor', { name: l.name })} value={received(l.variantId, l.qtySent)}
                pattern="[0-9]*" autoComplete="off" enterKeyHint="next"
                onChange={(e) => { const digits = e.target.value.replace(/\D/g, '').slice(0, 9); const n = Math.max(0, Math.min(l.qtySent, Number(digits) || 0)); setGot((g) => ({ ...g, [l.variantId]: n })); }} />
            ) : <span className="t-title3 tnum">{number(x.status === 'received' ? l.qtyReceived ?? 0 : l.qtySent, locale)}</span>} />
        ))}
      </Group>

      {canSend ? (
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api.sendTransfer(org.orgId, x.id), t('transfers.sent'))}>{t('transfers.send')}</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => api.cancelTransfer(org.orgId, x.id), t('transfers.cancelled'))}>{t('transfers.cancel')}</button>
        </div>
      ) : null}
      {canReceive ? (
        <div>
          {short > 0 ? <p className="t-sub mb-3" role="status" style={{ color: 'var(--c-neg-text)' }}>{t('transfers.shortWarn', { n: number(short, locale) })}</p> : null}
          <button type="button" className="btn btn-primary btn-large" style={{ maxWidth: 360 }} disabled={busy}
            onClick={() => void run(() => api.receiveTransfer(org.orgId, x.id, x.lines.map((l) => ({ variantId: l.variantId, qtyReceived: received(l.variantId, l.qtySent) }))), t('transfers.received'))}>
            {t('transfers.receive')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
