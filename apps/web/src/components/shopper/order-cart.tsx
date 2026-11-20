'use client';

// "your order": what the customer put together on this phone, the shop to pick up from, a note
// and a day, the prices at that shop when the business shows them, then send. the order stays on
// the phone until the server took it (thinking/19-orders.md).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { OrderPreview } from '@custock/core';
import { Empty } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { DatePicker } from '@/components/ui/date-time-picker';
import { Counter } from '@/components/ui/field-kit';
import { IconBag, IconCheck, IconShop, IconTrash, IconWarning } from '@/components/ui/icons';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { displayTimeZone, money } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';
import { clearCart, qtyStep, removeFromCart, restoreCartLine, setCartMeta, setCartQty, useCart } from '@/lib/order-cart';
import { dayToMs, msToDay } from '@/lib/order-format';
import { useShopper } from './shopper-context';

export function OrderCart() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const { api, slug, status, follow, orders, orgName, joinCode } = useShopper();
  const cart = useCart(slug);
  const tz = displayTimeZone();
  const shopsTaking = orders?.shops ?? [];
  // the shop chosen before, if it still takes orders, else the first one that does
  const shopId = shopsTaking.some((s) => s.id === cart.shopId) ? cart.shopId! : shopsTaking[0]?.id ?? null;
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the prices and problems at the chosen shop, asked again whenever the order changes
  const key = useMemo(() => JSON.stringify({ shopId, lines: cart.lines.map((l) => [l.variantId, l.qty]) }), [shopId, cart.lines]);
  useEffect(() => {
    if (!shopId || !cart.lines.length) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.previewOrder(slug, { shopId, lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) })
        .then((p) => { if (alive) { setPreview(p); setPreviewKey(key); } }, () => { if (alive) { setPreview(null); setPreviewKey(key); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [api, slug, shopId, key, cart.lines]);

  if (orders === undefined) return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (!orders) {
    return <Empty icon={<IconBag size={40} />} title={t('orders.offTitle', { org: orgName })} body={t('orders.offBody')} action={<Link href={`/s/${slug}`} className="btn btn-tinted">{t('orders.browse')}</Link>} />;
  }
  if (!cart.lines.length) {
    return <Empty icon={<IconBag size={40} />} title={t('orders.emptyTitle')} body={t('orders.emptyBody')} action={<Link href={`/s/${slug}`} className="btn btn-primary">{t('orders.browse')}</Link>} />;
  }

  const fresh = previewKey === key ? preview : null;
  const lineOf = (variantId: string) => fresh?.lines.find((l) => l.variantId === variantId) ?? null;
  const problems = fresh?.lines.filter((l) => l.problem) ?? [];
  const priced = fresh?.priced ?? false;
  const noRoom = fresh ? fresh.limits.openLeft <= 0 : false;

  const remove = (variantId: string) => {
    const index = cart.lines.findIndex((l) => l.variantId === variantId);
    const line = cart.lines[index];
    if (!line) return;
    removeFromCart(slug, variantId);
    toast(t('orders.removed', { name: line.name }), { label: t('common:action.undo'), run: () => restoreCartLine(slug, line, index) });
  };

  const send = async () => {
    if (!shopId || !fresh) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api.placeOrder(slug, {
        shopId,
        lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, seenUnitPriceMinor: priced ? lineOf(l.variantId)?.unitPriceMinor ?? null : null })),
        note: cart.note.trim() || null,
        wantedOn: cart.wantedOn,
      });
      clearCart(slug);
      toast(t(order.priced ? 'orders.sentToast' : 'orders.askedToast', { number: order.number }));
      router.push(`/s/${slug}/orders/${order.id}`);
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      if (code === 'prices_changed') {
        // fresh prices, the customer looks once more before sending
        setPreviewKey('');
        setPreview(await api.previewOrder(slug, { shopId, lines: cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) }).catch(() => null));
        setPreviewKey(key);
      }
      setError(t(`orders.error.${code}`, { defaultValue: t(`common:error.${code}`, { defaultValue: t('common:error.internal') }) }));
    } finally {
      setBusy(false);
    }
  };

  const wantedMs = cart.wantedOn ? dayToMs(cart.wantedOn, tz) : null;
  const signedOut = status === 'signedOut';
  const notFollowing = status === 'signedIn' && !follow;

  return (
    <div className="flex flex-col gap-1">
      <ul className="list mb-2" role="list" aria-label={t('orders.linesLabel')}>
        {cart.lines.map((l) => {
          const p = lineOf(l.variantId);
          const step = qtyStep(l.uom);
          return (
            <li key={l.variantId} className="row has-icon flex-wrap gap-y-2" style={{ '--sep-inset': '72px', paddingTop: 10, paddingBottom: 10 } as React.CSSProperties}>
              <Photo src={l.imageUrl} alt={l.name} size={44} />
              <span className="row-main min-w-[8rem]">
                <Link href={`/s/${slug}/p/${l.productId}`} className="row-title block hover:no-underline" style={{ color: 'var(--c-ink)' }}>{p?.name ?? l.name}</Link>
                {p?.problem ? (
                  <span className="row-sub block" style={{ color: 'var(--c-error)' }}>{t(`orders.problem.${p.problem}`)}</span>
                ) : p?.unitPriceMinor != null && fresh?.priced ? (
                  <span className="row-sub block tnum">{money(p.lineTotalMinor ?? 0, fresh.currency, locale)}</span>
                ) : null}
              </span>
              <span className="inline-flex items-center gap-1 ml-auto">
                <QtyStepper value={l.qty} uom={l.uom} step={step} min={step} max={orders.limits.maxQty * (l.uom === 'piece' ? 1 : 1000)} onChange={(v) => setCartQty(slug, l.variantId, v)} label={t('order.qtyOf', { name: l.name })} />
                <button type="button" className="icon-btn" aria-label={t('orders.remove', { name: l.name })} onClick={() => remove(l.variantId)}><IconTrash size={18} /></button>
              </span>
            </li>
          );
        })}
        <li className="row">
          <span className="row-main row-title" style={{ fontWeight: 600 }}>{t('orders.total')}</span>
          <span className="t-headline tnum">
            {fresh && priced && fresh.totalMinor != null ? money(fresh.totalMinor, fresh.currency, locale) : <span className="t-2 t-body">{fresh ? t('orders.shopPrices') : '…'}</span>}
          </span>
        </li>
      </ul>
      <p className="inset-group-foot mb-5">{fresh && !priced ? t('orders.askFoot', { org: orgName }) : t('orders.pricedFoot')}</p>

      <section className="inset-group">
        <h2 className="inset-group-head">{t('orders.pickUp')}</h2>
        {shopsTaking.length > 1 ? (
          <ul className="list" role="radiogroup" aria-label={t('orders.pickUp')}>
            {shopsTaking.map((s) => (
              <li key={s.id}>
                <button type="button" role="radio" aria-checked={s.id === shopId} className="row has-icon w-full text-left" onClick={() => setCartMeta(slug, { shopId: s.id })}>
                  <span className="icon-tile"><IconShop size={18} /></span>
                  <span className="row-main">
                    <span className="row-title block">{s.name}</span>
                    {s.address || s.city ? <span className="row-sub block">{[s.address, s.city].filter(Boolean).join(', ')}</span> : null}
                  </span>
                  {s.id === shopId ? <IconCheck size={20} style={{ color: 'var(--c-accent)' }} /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="list">
            <div className="row has-icon">
              <span className="icon-tile"><IconShop size={18} /></span>
              <span className="row-main">
                <span className="row-title block">{shopsTaking[0]?.name}</span>
                {shopsTaking[0]?.address || shopsTaking[0]?.city ? <span className="row-sub block">{[shopsTaking[0]?.address, shopsTaking[0]?.city].filter(Boolean).join(', ')}</span> : null}
              </span>
            </div>
          </div>
        )}
        <p className="inset-group-foot">{t('orders.payFoot')}</p>
      </section>

      <section className="inset-group">
        <h2 className="inset-group-head">{t('orders.details')}</h2>
        <div className="list">
          <DatePicker variant="row" label={t('orders.wantedOn')} value={wantedMs} onChange={(ms) => setCartMeta(slug, { wantedOn: ms == null ? null : msToDay(ms, tz) })}
            timeZone={tz} dayEdge="start" future optional placeholder={t('orders.wantedAny')} />
          <label className="block row-sep">
            <span className="field-label">{t('orders.note')}</span>
            <textarea className="field pt-1" rows={3} maxLength={500} placeholder={t('orders.notePlaceholder')} value={cart.note}
              onChange={(e) => setCartMeta(slug, { note: e.target.value })} />
          </label>
        </div>
        <div className="px-4"><Counter value={cart.note} max={500} /></div>
      </section>

      {problems.length ? <p className="t-sub m-0 mb-3 flex gap-2 items-start" role="alert" style={{ color: 'var(--c-error)' }}><IconWarning size={18} className="flex-none mt-0.5" />{t('orders.fixLines')}</p> : null}
      {noRoom ? <p className="t-sub m-0 mb-3" role="alert">{t('orders.error.limit_reached')}</p> : null}
      {error ? <p className="sheet-error" role="alert">{error}</p> : null}

      {signedOut ? (
        <Link href={`/s/${slug}/me`} className="btn btn-primary btn-large">{t('orders.signInToSend')}</Link>
      ) : notFollowing && joinCode ? (
        <Link href={`/j/${joinCode}`} className="btn btn-primary btn-large">{t('orders.joinToSend', { org: orgName })}</Link>
      ) : (
        <button type="button" className="btn btn-primary btn-large" disabled={busy || !fresh || !shopId || problems.length > 0 || noRoom || status === 'loading'} onClick={() => void send()}>
          <IconBag size={20} />{priced ? t('orders.send') : t('orders.ask')}
        </button>
      )}
      <p className="t-foot t-2 text-center m-0 mt-3">{priced ? t('orders.sendFoot') : t('orders.askSendFoot')}</p>
      <div className="h-2" />
    </div>
  );
}
