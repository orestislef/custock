'use client';

// one order on the customer's side: where it stands in plain words, the price to answer when the
// shop sent one, the lines and the history. the page a push about the order opens.

import Link from 'next/link';
import { useState } from 'react';
import type { Order } from '@custock/core';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { Gone } from '@/components/ui/gone';
import { IconCheck, IconClock, IconShop } from '@/components/ui/icons';
import { OrderHistory, OrderLinesList, OrderStatusBadge } from '@/components/orders/order-bits';
import { dateTime, displayTimeZone, money } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';
import { dayText } from '@/lib/order-format';
import { useAsync } from '@/lib/use-async';
import { SignInCard } from './sign-in';
import { useShopper } from './shopper-context';

export function CustomerOrder({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { api, slug, status } = useShopper();
  const q = useAsync(() => (status === 'signedIn' ? api.myOrder(slug, id) : Promise.resolve(null)), [slug, id, status], { refreshOnReturn: true });
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (status === 'loading' || (status === 'signedIn' && q.data === undefined && !q.error)) return <div className="h-64 rounded-[16px] skel" aria-busy="true" />;
  if (status === 'signedOut') return <SignInCard />;
  const o = q.data;
  if (!o) {
    return <Gone title={t('orders.goneTitle')} body={t('orders.goneBody')} href={`/s/${slug}/orders`} cta={t('orders.mineTitle')} />;
  }

  const act = async (run: () => Promise<Order>, done: string) => {
    setBusy(true);
    try {
      q.setData(await run());
      toast(done);
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      toast(t(`orders.error.${code}`, { defaultValue: t(`common:error.${code}`, { defaultValue: t('common:error.internal') }) }));
      void q.reload();
    } finally {
      setBusy(false);
    }
  };

  const wanted = dayText(o.wantedOn, locale, displayTimeZone());
  const can = (a: Order['actions'][number]) => o.actions.includes(a);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h1 className="t-large t-display m-0">{t('orders.number', { number: o.number })}</h1>
        <OrderStatusBadge status={o.status} side="customer" />
      </div>
      <p className="t-sub t-2 m-0 mb-5 flex items-center gap-1.5"><IconShop size={16} />{o.shopName}{wanted ? ` · ${t('orders.forDay', { day: wanted })}` : ''}</p>

      {o.status === 'quoted' ? (
        <section className="card p-4 mb-5" aria-label={t('orders.quoteTitle')}>
          <p className="eyebrow m-0">{t('orders.quoteTitle')}</p>
          <p className="t-large t-display tnum m-0 mt-1">{o.totalMinor != null ? money(o.totalMinor, o.currency, locale) : ''}</p>
          {o.quoteMessage ? <p className="t-body m-0 mt-2">“{o.quoteMessage}”</p> : null}
          {o.quoteValidUntil ? <p className="t-sub t-2 m-0 mt-2 flex items-center gap-1.5"><IconClock size={16} />{t('orders.holdsUntil', { at: dateTime(o.quoteValidUntil, locale) })}</p> : null}
          <div className="flex flex-col gap-2 mt-4">
            <button type="button" className="btn btn-primary btn-large" disabled={busy || !can('accept')} onClick={() => void act(() => api.acceptQuote(slug, o.id), t('orders.acceptedToast'))}>
              <IconCheck size={20} />{t('orders.accept')}
            </button>
            <button type="button" className="btn btn-tinted btn-large" disabled={busy || !can('reject')} onClick={() => void act(() => api.rejectQuote(slug, o.id), t('orders.rejectedToast'))}>
              {t('orders.reject')}
            </button>
          </div>
        </section>
      ) : (
        <p className="card p-4 m-0 mb-5 t-body" role="status">
          {t(`orders.state.${o.status}${o.status === 'requested' && o.priced ? 'Priced' : ''}`, { shop: o.shopName })}
          {o.cancelReason && (o.status === 'declined' || o.status === 'cancelled') ? <span className="block t-sub t-2 mt-1">{t('orders.reason', { reason: o.cancelReason })}</span> : null}
        </p>
      )}

      <section className="inset-group">
        <h2 className="inset-group-head">{t('orders.linesHead')}</h2>
        <OrderLinesList order={o} side="customer" />
        {o.note ? <p className="inset-group-foot">{t('orders.yourNote', { note: o.note })}</p> : null}
      </section>

      <section className="inset-group">
        <h2 className="inset-group-head">{t('orders.history')}</h2>
        <OrderHistory order={o} side="customer" />
      </section>

      {can('cancel') ? (
        <div className="flex justify-center mb-4">
          <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)}>{t('orders.cancel')}</button>
        </div>
      ) : null}
      {o.status !== 'requested' && o.status !== 'quoted' && o.status !== 'confirmed' && o.status !== 'ready' ? (
        <div className="flex justify-center mb-4"><Link href={`/s/${slug}`} className="btn btn-tinted">{t('orders.orderAgain')}</Link></div>
      ) : null}

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('orders.cancelTitle', { number: o.number })}
        footer={<button type="button" className="btn btn-danger-fill btn-large" disabled={busy} onClick={() => { setCancelOpen(false); void act(() => api.cancelMyOrder(slug, o.id, reason.trim() || null), t('orders.cancelledToast')); }}>{t('orders.cancelConfirm')}</button>}>
        <p className="t-body m-0 mb-4">{t('orders.cancelBody')}</p>
        <div className="list">
          <label className="block">
            <span className="field-label">{t('orders.cancelReason')}</span>
            <textarea className="field pt-1" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('orders.optional')} />
          </label>
        </div>
      </Sheet>
    </>
  );
}
