'use client';

// pieces both sides of an order share: the status badge, the lines with their prices, and the
// history in plain words. the customer never sees staff names, the shop does.

import type { Order, OrderEvent, OrderLine, OrderStatus } from '@custock/core';
import { IconBag, IconCheck, IconClock, IconClose, IconTag, IconWarning } from '@/components/ui/icons';
import { Photo } from '@/components/ui/client-kit';
import { dateTime, money, qtyNumber } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';

type Side = 'staff' | 'customer';

const TONE: Record<OrderStatus, string> = {
  requested: 'badge-accent', quoted: 'badge-few', confirmed: 'badge-info', ready: 'badge-ok',
  completed: 'badge-gray', declined: 'badge-gray', rejected: 'badge-gray', cancelled: 'badge-gray', expired: 'badge-gray',
};

export function OrderStatusBadge({ status, side }: { status: OrderStatus; side: Side }) {
  const t = useT();
  return <span className={`badge ${TONE[status]}`}>{t(side === 'staff' ? `common:orderStatus.${status}` : `orders.status.${status}`)}</span>;
}

export function qtyWithUnit(t: ReturnType<typeof useT>, qty: number, uom: OrderLine['uom'], locale: string): string {
  return uom === 'piece' ? `${qtyNumber(qty, uom, locale)} ×` : `${qtyNumber(qty, uom, locale)} ${t(`common:uom.${uom}`)}`;
}

// the lines as the order stands: photo, name, quantity, price per unit and line total when known
export function OrderLinesList({ order, side }: { order: Order; side: Side }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ul className="list" role="list">
      {order.lines.map((l) => (
        <li key={l.lineNo} className="row has-icon" style={{ '--sep-inset': '72px', alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 } as React.CSSProperties}>
          <Photo src={l.imageUrl} alt={l.name} size={44} />
          <span className="row-main min-w-0">
            <span className="row-title block">{l.name}</span>
            <span className="row-sub block tnum">
              {qtyWithUnit(t, l.qty, l.uom, locale)}
              {l.unitPriceMinor != null ? ` ${money(l.unitPriceMinor, order.currency, locale)}${l.uom === 'piece' ? '' : ` / ${t(`common:uom.${l.uom}`)}`}` : ''}
            </span>
            {l.qty !== l.requestedQty ? (
              <span className="row-sub block" style={{ color: 'var(--c-few-text)' }}>{t('orders.qtyChanged', { asked: qtyWithUnit(t, l.requestedQty, l.uom, locale).replace(/ ×$/, '') })}</span>
            ) : null}
            {l.note ? <span className="row-sub block">{l.note}</span> : null}
            {side === 'staff' && l.onHand != null ? (
              <span className="row-sub block tnum">
                {t('orders.stockLine', { onHand: qtyNumber(l.onHand, l.uom, locale) })}
                {l.onOtherOrders ? ` · ${t('orders.onOtherOrders', { qty: qtyNumber(l.onOtherOrders, l.uom, locale) })}` : ''}
              </span>
            ) : null}
          </span>
          <span className="t-body tnum flex-none">{l.lineTotalMinor != null ? money(l.lineTotalMinor, order.currency, locale) : ''}</span>
        </li>
      ))}
      <li className="row">
        <span className="row-main row-title" style={{ fontWeight: 600 }}>{t('orders.total')}</span>
        <span className="t-headline tnum">{order.totalMinor != null ? money(order.totalMinor, order.currency, locale) : <span className="t-2">{t('orders.priceToCome')}</span>}</span>
      </li>
    </ul>
  );
}

function eventIcon(kind: OrderEvent['kind']) {
  if (kind === 'requested') return <IconBag size={16} />;
  if (kind === 'quoted') return <IconTag size={16} />;
  if (kind === 'confirmed' || kind === 'accepted') return <IconCheck size={16} />;
  if (kind === 'ready') return <IconBag size={16} />;
  if (kind === 'completed') return <IconCheck size={16} />;
  if (kind === 'expired') return <IconClock size={16} />;
  if (kind === 'declined' || kind === 'rejected' || kind === 'cancelled') return <IconClose size={16} />;
  return <IconWarning size={16} />;
}

// one line per step, newest last like a conversation
export function OrderHistory({ order, side }: { order: Order; side: Side }) {
  const t = useT();
  const locale = useLocale();
  const who = (e: OrderEvent) => (e.actor === 'customer' ? 'customer' : e.actor === 'system' ? 'system' : 'shop');
  return (
    <ol className="list" role="list" aria-label={t('orders.history')}>
      {order.events.map((e) => {
        const total = e.totalMinor != null ? money(e.totalMinor, order.currency, locale) : '';
        const key = `orders.event.${side}.${e.kind}.${who(e)}`;
        const text = t(key, { defaultValue: t(`orders.event.${side}.${e.kind}.any`, { total, name: e.actorName ?? '' }), total, name: e.actorName ?? '' });
        return (
          <li key={e.id} className="row has-icon" style={{ alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
            <span className="icon-tile" aria-hidden="true">{eventIcon(e.kind)}</span>
            <span className="row-main min-w-0">
              <span className="row-title block">{text}</span>
              {e.message ? <span className="row-sub block">“{e.message}”</span> : null}
              {e.reason ? <span className="row-sub block">{t('orders.reason', { reason: e.reason })}</span> : null}
              <span className="row-sub block">{dateTime(e.at, locale)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
