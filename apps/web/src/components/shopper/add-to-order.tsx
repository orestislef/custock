'use client';

// "add to order" on a product in a business's app: how many, then into the order on the phone.
// only when the business takes orders from at least one shop. signing in waits for sending.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PublicProduct } from '@custock/core';
import { IconBag, IconCheck } from '@/components/ui/icons';
import { QtyStepper } from '@/components/ui/qty-stepper';
import { useToast } from '@/components/ui/client-kit';
import { qtyNumber } from '@/lib/format';
import { addToCart, qtyStep, useCart } from '@/lib/order-cart';
import { useLocale, useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

export function AddToOrder({ p }: { p: PublicProduct }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const { slug, orders } = useShopper();
  const cart = useCart(slug);
  const uom = p.uom ?? 'piece';
  const step = qtyStep(uom);
  const [qty, setQty] = useState(step);
  if (!orders) return null;
  const max = orders.limits.maxQty * (uom === 'piece' ? 1 : 1000);
  const inOrder = cart.lines.find((l) => l.variantId === p.variantId);
  const full = !inOrder && cart.lines.length >= orders.limits.maxLines;

  const add = () => {
    addToCart(slug, { variantId: p.variantId, productId: p.id, name: p.name, imageUrl: p.images[0]?.url ?? null, uom, qty });
    toast(t('order.added', { name: p.name }), { label: t('order.view'), run: () => router.push(`/s/${slug}/order`) });
    setQty(step);
  };

  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={t('order.addTitle')}>
      <div className="flex items-center justify-between gap-3">
        <span className="t-headline">{t('order.howMany')}</span>
        <QtyStepper value={qty} uom={uom} step={step} min={step} max={max} onChange={setQty} label={t('order.qtyOf', { name: p.name })} />
      </div>
      <button type="button" className="btn btn-primary btn-large" disabled={full} onClick={add}>
        <IconBag size={20} />{t('order.add')}
      </button>
      {full ? <p className="t-foot t-2 m-0">{t('order.full', { count: orders.limits.maxLines })}</p> : null}
      {inOrder ? (
        <Link href={`/s/${slug}/order`} className="t-sub inline-flex items-center gap-2 min-h-[36px] self-start">
          <IconCheck size={16} style={{ color: 'var(--c-success)' }} />
          {t('order.inOrder', { qty: qtyNumber(inOrder.qty, uom, locale), unit: uom === 'piece' ? '' : t(`common:uom.${uom}`) }).replace(/\s+/g, ' ')}
        </Link>
      ) : null}
    </section>
  );
}
