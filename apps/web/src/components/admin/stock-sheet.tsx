'use client';

// receive or adjust stock from the web. the phone app does this by scanning, the admin does it
// for corrections and big deliveries. every change is a movement with undo, see thinking/05.

import { useState } from 'react';
import { uuidv7, type AdjustReason, type MovementBatchResult, type Product, type StockLevel } from '@custock/core';
import { useAdmin } from './admin-context';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { Segmented, Why } from '@/components/ui/kit';
import { IconMinus, IconPlus } from '@/components/ui/icons';
import { productName, variantLabel } from '@/lib/names';
import { qtyNumber } from '@/lib/format';

export type StockMode = 'receive' | 'adjust';

const REASONS: AdjustReason[] = ['found', 'lost', 'damaged', 'expired', 'theft', 'own_use', 'correction'];

export function StockSheet({ open, onClose, product, mode, onDone }: {
  open: boolean; onClose: () => void; product: Product & { levels: StockLevel[] }; mode: StockMode;
  onDone: (r: MovementBatchResult) => void;
}) {
  const { api, org, t, locale, can, shops, shopId } = useAdmin();
  const toast = useToast();
  const perm = mode === 'receive' ? 'stock.receive' : 'stock.adjust';
  const allowed = shops.filter((s) => can(perm, s.id));
  const [shop, setShop] = useState<string>(shopId && allowed.some((s) => s.id === shopId) ? shopId : allowed[0]?.id ?? '');
  const [variant, setVariant] = useState(product.variants[0]?.id ?? '');
  const [qty, setQty] = useState(mode === 'receive' ? 1 : -1);
  const [reason, setReason] = useState<AdjustReason>('correction');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const scale = product.uom === 'piece' ? 1 : 1000;

  // any change to what is being saved asks again
  const changeQty = (next: number | ((q: number) => number)) => { setQty(next); setConfirming(false); };

  const current = product.levels.find((l) => l.shopId === shop && l.variantId === variant)?.onHand ?? 0;
  const after = current + qty * scale;
  const big = Math.abs(qty) > 50;
  const negative = after < 0;

  async function submit() {
    if (!shop || qty === 0) return;
    // big or negative moves ask once more, inline, instead of an alert
    if ((big || negative) && !confirming) { setConfirming(true); return; }
    setBusy(true);
    const id = uuidv7();
    try {
      const kind = mode === 'receive' ? 'receive' : reason === 'damaged' || reason === 'expired' || reason === 'theft' ? 'damage' : 'adjust';
      const res = await api.postMovements(org.orgId, [{
        id, shopId: shop, variantId: variant, qtyDelta: qty * scale, kind, occurredAt: Date.now(),
        ...(mode === 'adjust' ? { reason } : {}), ...(note ? { note } : {}),
      }]);
      if (res.rejected.length) {
        toast(t(`common:error.${res.rejected[0]!.code}`));
      } else {
        onDone(res);
        const name = productName(product, locale);
        const text = mode === 'receive'
          ? t('stockSheet.received', { count: qty, name })
          : t('stockSheet.adjusted', { qty: qty > 0 ? `+${qty}` : String(qty), name });
        toast(text, {
          label: t('common:action.undo'),
          run: () => {
            void api.postMovements(org.orgId, [{ id: uuidv7(), shopId: shop, variantId: variant, qtyDelta: -qty * scale, kind: 'reversal', refType: 'reversal', refId: id, occurredAt: Date.now() }])
              .then((r) => { onDone(r); toast(t('stockSheet.undone')); });
          },
        }, 10_000);
        onClose();
      }
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(mode === 'receive' ? 'stockSheet.receiveTitle' : 'stockSheet.adjustTitle')}
      footer={
        <button type="button" className="btn btn-primary btn-large" disabled={busy || !shop || qty === 0} onClick={() => void submit()}>
          {confirming ? t('stockSheet.confirmButton') : mode === 'receive' ? t('stockSheet.receiveButton', { count: Math.abs(qty) }) : t('stockSheet.adjustButton')}
        </button>
      }
    >
      <p className="t-headline m-0 mb-4">{productName(product, locale)}</p>

      <div className="list mb-4">
        <label className="row">
          <span className="row-main row-title">{t('stockSheet.shop')}</span>
          <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={shop} onChange={(e) => { setShop(e.target.value); setConfirming(false); }}>
            {allowed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {product.variants.length > 1 ? (
          <label className="row">
            <span className="row-main row-title">{t('stockSheet.variant')}</span>
            <select className="t-body bg-transparent border-0 outline-none text-right" style={{ color: 'var(--c-ink-2)' }} value={variant} onChange={(e) => { setVariant(e.target.value); setConfirming(false); }}>
              {product.variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v.options) || v.sku}</option>)}
            </select>
          </label>
        ) : null}
        <div className="row">
          <span className="row-main">
            <span className="row-title block">{t('stockSheet.qty')}</span>
            <span className="row-sub block tnum">{t('stockSheet.nowAfter', { now: qtyNumber(current, product.uom, locale), after: qtyNumber(after, product.uom, locale) })}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)', width: 36, height: 36 }} aria-label={t('stockSheet.less')} onClick={() => changeQty((q) => (mode === 'receive' ? Math.max(1, q - 1) : q - 1 === 0 ? -1 : q - 1))}><IconMinus size={18} /></button>
            <input
              aria-label={t('stockSheet.qty')}
              className="t-title3 tnum text-center bg-transparent border-0 outline-none w-16"
              inputMode="numeric"
              value={qty}
              onChange={(e) => { const n = Number(e.target.value.replace(/[^\d-]/g, '')); if (!Number.isNaN(n)) changeQty(mode === 'receive' ? Math.abs(n) : n); }}
            />
            <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)', width: 36, height: 36 }} aria-label={t('stockSheet.more')} onClick={() => changeQty((q) => (q + 1 === 0 ? 1 : q + 1))}><IconPlus size={18} /></button>
          </span>
        </div>
      </div>

      {mode === 'adjust' ? (
        <section className="group">
          <h3 className="group-head">{t('stockSheet.reason')}</h3>
          <div className="px-1 overflow-x-auto"><Segmented label={t('stockSheet.reason')} value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(`common:reason.${r}`) }))} /></div>
          <p className="group-foot">{t('stockSheet.reasonFoot')}</p>
        </section>
      ) : null}

      <div className="list mb-2">
        <input className="field" placeholder={t('stockSheet.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      {confirming ? <p className="t-sub mt-3 mb-0" role="alert" style={{ color: negative ? 'var(--c-neg-text)' : 'var(--c-ink)' }}>{t(negative ? 'stockSheet.confirmNegative' : 'stockSheet.confirmBig', { count: Math.abs(qty) })}</p> : negative ? <p className="t-foot mt-2 mb-0" style={{ color: 'var(--c-neg-text)' }}>{t('stockSheet.negativeHint')}</p> : null}
      {allowed.length < shops.length ? <p className="mt-2 mb-0"><Why>{t('stockSheet.onlyYourShops')}</Why></p> : null}
    </Sheet>
  );
}
