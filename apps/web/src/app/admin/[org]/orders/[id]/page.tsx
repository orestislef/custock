'use client';

// one order on the shop's side: who, what, for when, the stock in that shop and what other orders
// already hold, then the step this person may take: send a price, confirm, decline, ready, picked
// up, cancel. every step lands in the history with a name (thinking/19-orders.md).

import Link from '@/components/admin/org-link';
import { use, useState } from 'react';
import { formatMoneyInput, orderLineTotal, parseMoneyInput, type Order, type OrderQuoteInput } from '@custock/core';
import { LOCALE_NAMES } from '@custock/i18n/client';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Gone } from '@/components/ui/gone';
import { Photo, Sheet, useToast } from '@/components/ui/client-kit';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Counter } from '@/components/ui/field-kit';
import { IconBag, IconCheck, IconClock, IconMail, IconPhone, IconShop, IconTag } from '@/components/ui/icons';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { OrderHistory, OrderLinesList, OrderStatusBadge, qtyWithUnit } from '@/components/orders/order-bits';
import { dateTime, displayTimeZone, money, qtyNumber } from '@/lib/format';
import { dayText } from '@/lib/order-format';
import { qtyStep } from '@/lib/order-cart';
import { useAsync } from '@/lib/use-async';

const DAY = 86_400_000;

export default function StaffOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale } = useAdmin();
  const toast = useToast();
  const q = useAsync(() => api.order(org.orgId, id), [id], { refreshOnReturn: true });
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | 'decline' | 'cancel'>(null);

  if (q.error) {
    return <Page title={t('orders.staffTitle')}><Gone title={t('orders.goneTitle')} body={t('orders.goneStaffBody')} href="/admin/orders" cta={t('orders.staffTitle')} /></Page>;
  }
  const o = q.data;
  if (!o) return <Page title={t('orders.staffTitle')}><div className="h-64 skel" aria-busy="true" /></Page>;

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
  const can = (a: Order['actions'][number]) => o.actions.includes(a);
  const wanted = dayText(o.wantedOn, locale, displayTimeZone());
  const c = o.customer;

  return (
    <Page title={t('orders.number', { number: o.number })} back={{ href: '/admin/orders', label: t('orders.staffTitle') }}>
      <div className="flex items-center gap-2 flex-wrap -mt-3 mb-5">
        <OrderStatusBadge status={o.status} side="staff" />
        <span className="t-sub t-2 inline-flex items-center gap-1.5"><IconShop size={16} />{o.shopName}</span>
        {wanted ? <span className="t-sub t-2 inline-flex items-center gap-1.5"><IconClock size={16} />{t('orders.forDay', { day: wanted })}</span> : null}
        <span className="t-sub t-2">{t('orders.sentAt', { at: dateTime(o.createdAt, locale) })}</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8">
        <div>
          {o.note ? (
            <section className="card p-4 mb-5" aria-label={t('orders.customerNote')}>
              <p className="eyebrow m-0">{t('orders.customerNote')}</p>
              <p className="t-body m-0 mt-1 whitespace-pre-line">{o.note}</p>
            </section>
          ) : null}

          <section className="inset-group">
            <h2 className="inset-group-head">{o.priced ? t('orders.linesPriced') : t('orders.linesAsk')}</h2>
            <OrderLinesList order={o} side="staff" />
            {o.status === 'quoted' && o.quoteValidUntil ? (
              <p className="inset-group-foot">{t('orders.quoteSentFoot', { at: dateTime(o.quoteValidUntil, locale), name: o.quotedByName ?? '' })}</p>
            ) : o.status === 'requested' && !o.priced ? <p className="inset-group-foot">{t('orders.askStaffFoot')}</p> : null}
          </section>
          {o.quoteMessage && o.status === 'quoted' ? <p className="t-sub t-2 m-0 -mt-3 mb-6 px-4">“{o.quoteMessage}”</p> : null}

          {o.actions.length ? (
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-8">
              {can('confirm') ? <button type="button" className="btn btn-primary btn-large sm:w-auto sm:px-6" disabled={busy} onClick={() => void act(() => api.confirmOrder(org.orgId, o.id), t('orders.confirmedToast'))}><IconCheck size={20} />{t('orders.confirm')}</button> : null}
              {can('quote') ? <button type="button" className={`btn ${can('confirm') ? 'btn-tinted' : 'btn-primary'} btn-large sm:w-auto sm:px-6`} disabled={busy} onClick={() => setQuoting(true)}><IconTag size={20} />{o.status === 'quoted' ? t('orders.changePrice') : can('confirm') ? t('orders.changePrices') : t('orders.sendPrice')}</button> : null}
              {can('ready') ? <button type="button" className="btn btn-primary btn-large sm:w-auto sm:px-6" disabled={busy} onClick={() => void act(() => api.readyOrder(org.orgId, o.id), t('orders.readyToast'))}><IconBag size={20} />{t('orders.markReady')}</button> : null}
              {can('complete') ? <button type="button" className={`btn ${can('ready') ? 'btn-tinted' : 'btn-primary'} btn-large sm:w-auto sm:px-6`} disabled={busy} onClick={() => void act(() => api.completeOrder(org.orgId, o.id), t('orders.completedToast'))}><IconCheck size={20} />{t('orders.markPicked')}</button> : null}
              {can('decline') ? <button type="button" className="btn btn-danger sm:w-auto" disabled={busy} onClick={() => setReasonFor('decline')}>{t('orders.decline')}</button> : null}
              {can('cancel') ? <button type="button" className="btn btn-danger sm:w-auto" disabled={busy} onClick={() => setReasonFor('cancel')}>{t('orders.cancelStaff')}</button> : null}
            </div>
          ) : null}
          {can('complete') ? <p className="t-foot t-2 m-0 -mt-6 mb-8">{t('orders.pickedFoot')}</p> : null}

          <section className="inset-group">
            <h2 className="inset-group-head">{t('orders.history')}</h2>
            <OrderHistory order={o} side="staff" />
          </section>
        </div>

        <aside>
          <section className="inset-group">
            <h2 className="inset-group-head">{t('orders.customer')}</h2>
            <div className="list">
              <div className="row">
                <span className="row-main">
                  <span className="row-title block">{c?.name ?? t('orders.erasedCustomer')}</span>
                  {c && !c.erased ? <span className="row-sub block">{t('orders.reads', { language: LOCALE_NAMES[c.locale] ?? c.locale })}</span> : null}
                </span>
                {c && !c.erased ? <Link href={`/admin/customers/${c.id}`} className="btn btn-plain">{t('orders.customerOpen')}</Link> : null}
              </div>
              {c?.email ? (
                c.contactMasked ? <div className="row has-icon"><span className="icon-tile"><IconMail size={18} /></span><span className="row-main t-body">{c.email}</span></div>
                  : <a href={`mailto:${c.email}`} className="row has-icon"><span className="icon-tile"><IconMail size={18} /></span><span className="row-main t-body truncate">{c.email}</span></a>
              ) : null}
              {c?.phone ? (
                c.contactMasked ? <div className="row has-icon"><span className="icon-tile"><IconPhone size={18} /></span><span className="row-main t-body tnum">{c.phone}</span></div>
                  : <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="row has-icon"><span className="icon-tile"><IconPhone size={18} /></span><span className="row-main t-body tnum">{c.phone}</span></a>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {quoting ? <QuoteSheet order={o} busy={busy} onClose={() => setQuoting(false)} onSend={(input) => { setQuoting(false); void act(() => api.quoteOrder(org.orgId, o.id, input), t('orders.quotedToast')); }} /> : null}

      <ReasonSheet open={reasonFor !== null} kind={reasonFor ?? 'decline'} number={o.number} busy={busy} onClose={() => setReasonFor(null)}
        onConfirm={(reason) => {
          const kind = reasonFor;
          setReasonFor(null);
          if (kind === 'decline') void act(() => api.declineOrder(org.orgId, o.id, reason), t('orders.declinedToast'));
          else void act(() => api.cancelOrder(org.orgId, o.id, reason), t('orders.cancelledStaffToast'));
        }} />
    </Page>
  );
}

// the price for every line, quantities the shop can do, how long the price holds and a message
function QuoteSheet({ order, busy, onClose, onSend }: { order: Order; busy: boolean; onClose: () => void; onSend: (input: OrderQuoteInput) => void }) {
  const { t, locale } = useAdmin();
  const [lines, setLines] = useState(() => order.lines.map((l) => ({
    lineNo: l.lineNo, qty: l.qty, note: l.note ?? '',
    price: l.unitPriceMinor != null ? formatMoneyInput(l.unitPriceMinor, locale) : '',
  })));
  // the price that still holds, else three days from when the sheet opened
  const [until, setUntil] = useState<number | null>(() => {
    const at = Date.now();
    return order.quoteValidUntil && order.quoteValidUntil > at ? order.quoteValidUntil : at + 3 * DAY;
  });
  const [message, setMessage] = useState(order.quoteMessage ?? '');
  const [bad, setBad] = useState<Record<number, boolean>>({});

  const parsed = lines.map((l) => {
    const r = l.price.trim() ? parseMoneyInput(l.price) : null;
    return r && r.ok ? r.value : null;
  });
  const total = order.lines.every((_, i) => parsed[i] != null)
    ? order.lines.reduce((a, l, i) => a + orderLineTotal(parsed[i]!, lines[i]!.qty, l.uom), 0)
    : null;

  const send = () => {
    const wrong: Record<number, boolean> = {};
    lines.forEach((l, i) => { if (parsed[i] == null) wrong[l.lineNo] = true; });
    setBad(wrong);
    if (Object.keys(wrong).length) return;
    onSend({
      lines: lines.map((l, i) => ({ lineNo: l.lineNo, unitPriceMinor: parsed[i]!, qty: l.qty, note: l.note.trim() || null })),
      validUntil: until ?? undefined,
      message: message.trim() || null,
    });
  };

  return (
    <Sheet open onClose={onClose} title={t('orders.quoteSheetTitle', { number: order.number })}
      footer={<button type="button" className="btn btn-primary btn-large" disabled={busy} onClick={send}><IconTag size={20} />{t('orders.sendPriceTo', { total: total != null ? money(total, order.currency, locale) : '' }).trim()}</button>}>
      <ul className="list mb-2" role="list">
        {order.lines.map((l, i) => {
          const line = lines[i]!;
          const step = qtyStep(l.uom);
          return (
            <li key={l.lineNo} className="row flex-col items-stretch gap-2" style={{ paddingTop: 12, paddingBottom: 12 }}>
              <span className="flex items-center gap-3">
                <Photo src={l.imageUrl} alt={l.name} size={40} />
                <span className="flex-1 min-w-0">
                  <span className="row-title block truncate">{l.name}</span>
                  <span className="row-sub block tnum">
                    {t('orders.asked', { qty: qtyWithUnit(t, l.requestedQty, l.uom, locale).replace(/ ×$/, '') })}
                    {l.onHand != null ? ` · ${t('orders.stockLine', { onHand: qtyNumber(l.onHand, l.uom, locale) })}` : ''}
                    {l.onOtherOrders ? ` · ${t('orders.onOtherOrders', { qty: qtyNumber(l.onOtherOrders, l.uom, locale) })}` : ''}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3 flex-wrap">
                <QtyStepper value={line.qty} uom={l.uom} step={step} min={step} max={999_999} onChange={(v) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: v } : y)))} label={t('order.qtyOf', { name: l.name })} />
                <label className="ml-auto inline-flex items-center gap-1.5">
                  <span className="t-sub t-2">{l.uom === 'piece' ? t('orders.pricePiece') : t('orders.pricePer', { unit: t(`common:uom.${l.uom}`) })}</span>
                  <input className="field tnum text-right w-24" style={{ minHeight: 40, background: 'var(--c-fill)', borderRadius: 10, padding: '0 10px' }}
                    inputMode="decimal" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="next"
                    aria-label={t('orders.priceOf', { name: l.name })} aria-invalid={bad[l.lineNo] || undefined}
                    placeholder="0,00" value={line.price}
                    onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))}
                    onBlur={() => {
                      const r = line.price.trim() ? parseMoneyInput(line.price) : null;
                      setBad((x) => ({ ...x, [l.lineNo]: !!line.price.trim() && !(r && r.ok) }));
                      if (r && r.ok) setLines((x) => x.map((y, j) => (j === i ? { ...y, price: formatMoneyInput(r.value, locale) } : y)));
                    }} />
                </label>
              </span>
              {bad[l.lineNo] ? <span className="t-foot" role="alert" style={{ color: 'var(--c-error)' }}>{t('orders.priceInvalid')}</span> : null}
              {parsed[i] != null ? <span className="t-foot t-2 tnum text-right">{t('orders.lineTotal', { total: money(orderLineTotal(parsed[i]!, line.qty, l.uom), order.currency, locale) })}</span> : null}
            </li>
          );
        })}
        <li className="row">
          <span className="row-main row-title" style={{ fontWeight: 600 }}>{t('orders.total')}</span>
          <span className="t-headline tnum">{total != null ? money(total, order.currency, locale) : '…'}</span>
        </li>
      </ul>
      <p className="inset-group-foot mb-4">{t('orders.vatFoot')}</p>
      <div className="list mb-2">
        <DateTimePicker label={t('orders.holdsTill')} value={until} onChange={setUntil} timeZone={displayTimeZone()} future variant="row" />
        <label className="block row-sep">
          <span className="field-label">{t('orders.message')}</span>
          <textarea className="field pt-1" rows={3} maxLength={500} value={message} placeholder={t('orders.messagePlaceholder')} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
      <div className="px-4"><Counter value={message} max={500} /></div>
      <p className="inset-group-foot">{t('orders.quoteFoot')}</p>
    </Sheet>
  );
}

// the shop always says why it declines or cancels: the customer reads it
function ReasonSheet({ open, kind, number, busy, onClose, onConfirm }: { open: boolean; kind: 'decline' | 'cancel'; number: number; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useAdmin();
  const [reason, setReason] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={t(kind === 'decline' ? 'orders.declineTitle' : 'orders.cancelStaffTitle', { number })}
      footer={<button type="button" className="btn btn-danger-fill btn-large" disabled={busy || !reason.trim()} onClick={() => { onConfirm(reason.trim()); setReason(''); }}>{t(kind === 'decline' ? 'orders.decline' : 'orders.cancelStaff')}</button>}>
      <p className="t-body m-0 mb-4">{t(kind === 'decline' ? 'orders.declineBody' : 'orders.cancelStaffBody')}</p>
      <div className="list">
        <label className="block">
          <span className="field-label">{t('orders.reasonLabel')}</span>
          <textarea className="field pt-1" rows={3} maxLength={300} value={reason} placeholder={t('orders.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="px-4"><Counter value={reason} max={300} /></div>
    </Sheet>
  );
}
