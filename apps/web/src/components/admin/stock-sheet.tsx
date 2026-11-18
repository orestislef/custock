'use client';

// receive, sell or adjust stock from the web. the phone app does this by scanning, the admin does it
// for corrections, big deliveries and the counter. every change is a movement with undo, see thinking/05.

import { useState } from 'react';
import { uuidv7, type AdjustReason, type MovementBatchResult, type Product, type StockLevel } from '@custock/core';
import { useAdmin } from './admin-context';
import { Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { Chips } from '@/components/ui/kit';
import { IconMinus, IconPlus } from '@/components/ui/icons';
import { productName, variantLabel } from '@/lib/names';
import { qtyNumber } from '@/lib/format';
import { submitMovements } from '@/lib/outbox';

export type StockMode = 'receive' | 'adjust' | 'sell';

const REASONS: AdjustReason[] = ['found', 'lost', 'damaged', 'expired', 'theft', 'own_use', 'correction'];
const PERM: Record<StockMode, string> = { receive: 'stock.receive', adjust: 'stock.adjust', sell: 'stock.sell' };

export function StockSheet({ open, onClose, product, mode, onDone, variantId }: {
  open: boolean; onClose: () => void; product: Product & { levels: StockLevel[] }; mode: StockMode;
  onDone: (r: MovementBatchResult) => void; variantId?: string;
}) {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const toast = useToast();
  const allowed = shops.filter((s) => can(PERM[mode], s.id));
  // default shop: the one selected, else where people wait, else where it ran out
  const firstVariant = variantId ?? product.variants[0]?.id ?? '';
  const levelsOf = (v: string) => product.levels.filter((l) => l.variantId === v && allowed.some((s) => s.id === l.shopId));
  const defaultShop = (shopId && allowed.some((s) => s.id === shopId) ? shopId : null)
    ?? (mode === 'receive' ? levelsOf(firstVariant).sort((a, b) => b.waiting - a.waiting).find((l) => l.waiting > 0)?.shopId : null)
    ?? (mode === 'receive' ? levelsOf(firstVariant).find((l) => l.onHand <= 0)?.shopId : null)
    ?? allowed[0]?.id ?? '';
  const [shop, setShop] = useState<string>(defaultShop);
  const [variant, setVariant] = useState(firstVariant);
  const [qty, setQty] = useState(mode === 'adjust' ? -1 : 1);
  const [reason, setReason] = useState<AdjustReason>('correction');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scale = product.uom === 'piece' ? 1 : 1000;
  const changeQty = (next: number | ((q: number) => number)) => { setQty(next); setConfirming(false); setError(null); };

  const current = product.levels.find((l) => l.shopId === shop && l.variantId === variant)?.onHand ?? 0;
  const delta = mode === 'sell' ? -Math.abs(qty) : qty;
  const after = current + delta * scale;
  const big = Math.abs(qty) > 50;
  const negative = after < 0;
  const v = product.variants.find((x) => x.id === variant);

  async function submit() {
    if (!shop || qty === 0) return;
    // big or negative moves ask once more, inline, instead of an alert
    if ((big || negative) && !confirming) { setConfirming(true); return; }
    setBusy(true);
    setError(null);
    const id = uuidv7();
    try {
      const kind = mode === 'receive' ? 'receive' : mode === 'sell' ? 'sale' : reason === 'damaged' || reason === 'expired' || reason === 'theft' ? 'damage' : 'adjust';
      // without signal the change waits on this device and syncs later (src/lib/outbox.ts)
      const sent = await submitMovements(api, org.orgId, [{
        id, shopId: shop, variantId: variant, qtyDelta: delta * scale, kind, occurredAt: Date.now(),
        ...(mode === 'adjust' ? { reason } : {}), ...(mode === 'sell' && v?.priceMinor != null ? { unitPriceMinor: v.priceMinor } : {}), ...(note ? { note } : {}),
      }]);
      const res = sent.result;
      if (res?.rejected.length) {
        setError(t(`common:error.${res.rejected[0]!.code}`));
      } else if (!res) {
        toast(mode === 'receive' ? t('offline.savedReceive', { count: qty }) : mode === 'sell' ? t('offline.savedSale', { count: Math.abs(qty), name: productName(product, locale) }) : t('offline.savedAdjust'));
        onClose();
      } else {
        onDone(res);
        const name = productName(product, locale);
        const text = mode === 'receive' ? t('stockSheet.received', { count: qty, name })
          : mode === 'sell' ? t('stockSheet.sold', { count: Math.abs(qty), name })
          : t('stockSheet.adjusted', { qty: qty > 0 ? `+${qty}` : `−${Math.abs(qty)}`, name });
        toast(text, {
          label: t('common:action.undo'),
          run: () => {
            void submitMovements(api, org.orgId, [{ id: uuidv7(), shopId: shop, variantId: variant, qtyDelta: -delta * scale, kind: 'reversal', refType: 'reversal', refId: id, occurredAt: Date.now() }])
              .then((r) => { if (r.result) onDone(r.result); toast(t('stockSheet.undone')); });
          },
        });
        onClose();
      }
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'receive' ? t('stockSheet.receiveTitle') : mode === 'sell' ? t('stockSheet.sellTitle') : t('stockSheet.adjustTitle');
  const button = confirming ? t('stockSheet.confirmButton')
    : mode === 'receive' ? t('stockSheet.receiveButton', { count: Math.abs(qty) })
    : mode === 'sell' ? t('stockSheet.sellButton', { count: Math.abs(qty) })
    : t('stockSheet.adjustButton');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      error={error}
      footer={
        <>
          <button type="button" className="btn btn-primary btn-large" disabled={busy || !shop || qty === 0} onClick={() => void submit()}>{button}</button>
          {shop && qty === 0 ? <p className="why-line">{t('stockSheet.needQty')}</p> : null}
        </>
      }
    >
      <p className="t-headline m-0 mb-4">{productName(product, locale)}</p>

      <ul className="list mb-4" role="list">
        <li className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <Picker variant="plain" label={t('stockSheet.shop')} value={shop} onChange={(x) => { setShop(x); setConfirming(false); }} options={allowed.map((s) => ({ value: s.id, label: s.name }))} />
        </li>
        {product.variants.length > 1 ? (
          <li className="row">
            <span className="row-main row-title">{t('stockSheet.variant')}</span>
            <Picker variant="plain" label={t('stockSheet.variant')} value={variant} onChange={(x) => { setVariant(x); setConfirming(false); }} options={product.variants.map((x) => ({ value: x.id, label: variantLabel(x.options) || x.sku || '' }))} />
          </li>
        ) : null}
        <li className="row">
          <span className="row-main">
            <span className="row-title block">{t('stockSheet.qty')}</span>
            <span className="row-sub block tnum">{t('stockSheet.nowAfter', { now: qtyNumber(current, product.uom, locale), after: qtyNumber(after, product.uom, locale) })}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)' }} aria-label={t('stockSheet.less')} onClick={() => changeQty((q) => (mode !== 'adjust' ? Math.max(1, q - 1) : q - 1 === 0 ? -1 : q - 1))}><IconMinus size={18} /></button>
            <input
              aria-label={t('stockSheet.qty')}
              className="t-title3 tnum text-center bg-transparent border-0 outline-none w-16"
              inputMode="numeric"
              value={qty}
              onChange={(e) => { const n = Number(e.target.value.replace(/[^\d-]/g, '')); if (!Number.isNaN(n)) changeQty(mode !== 'adjust' ? Math.abs(n) : n); }}
            />
            <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)' }} aria-label={t('stockSheet.more')} onClick={() => changeQty((q) => (q + 1 === 0 ? 1 : q + 1))}><IconPlus size={18} /></button>
          </span>
        </li>
      </ul>

      {mode === 'adjust' ? (
        <section className="inset-group">
          <h3 className="inset-group-head">{t('stockSheet.reason')}</h3>
          <Chips label={t('stockSheet.reason')} value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(`common:reason.${r}`) }))} />
          <p className="inset-group-foot">{t('stockSheet.reasonFoot')}</p>
        </section>
      ) : null}

      <div className="list mb-2">
        <input className="field" placeholder={t('stockSheet.note')} aria-label={t('stockSheet.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      {confirming ? <p className="t-sub mt-3 mb-0" role="alert" style={{ color: negative ? 'var(--c-neg-text)' : 'var(--c-ink)' }}>{t(negative ? 'stockSheet.confirmNegative' : 'stockSheet.confirmBig', { count: Math.abs(qty) })}</p> : negative ? <p className="t-foot mt-2 mb-0" style={{ color: 'var(--c-neg-text)' }}>{t('stockSheet.negativeHint')}</p> : null}
    </Sheet>
  );
}
