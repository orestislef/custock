'use client';

// per shop: price override and reorder point. each field shows only for someone who may change it.

import { useState } from 'react';
import type { Product, StockLevel } from '@custock/core';
import { useAdmin } from './admin-context';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { money, qtyNumber } from '@/lib/format';
import { productName } from '@/lib/names';

export function ShopSettingsSheet({ product, level, onClose, onSaved }: { product: Product; level: StockLevel; onClose: () => void; onSaved: () => void }) {
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const shop = shops.find((s) => s.id === level.shopId);
  const v = product.variants.find((x) => x.id === level.variantId);
  const scale = product.uom === 'piece' ? 1 : 1000;
  const canPrice = can('prices.shop.edit', level.shopId);
  const canReorder = can('stock.settings.manage', level.shopId);
  const [price, setPrice] = useState('');
  const [reorder, setReorder] = useState(level.reorderPoint != null ? String(level.reorderPoint / scale) : '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const priceMinor = price.trim() ? Math.round(Number(price.replace(',', '.')) * 100) : undefined;
      const reorderPoint = reorder.trim() === '' ? null : Math.round(Number(reorder.replace(',', '.')) * scale);
      await api.setShopVariantSettings(org.orgId, level.shopId, level.variantId, {
        ...(canPrice && priceMinor !== undefined ? { priceOverrideMinor: priceMinor } : {}),
        ...(canReorder ? { reorderPoint } : {}),
      });
      toast(t('settings.saved'));
      onSaved();
      onClose();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={shop?.name ?? ''}
      footer={<button type="button" className="btn btn-primary btn-large" disabled={busy} onClick={() => void save()}>{t('common:action.save')}</button>}>
      <p className="t-headline m-0 mb-4">{productName(product, locale)}</p>
      {canPrice ? (
      <section className="inset-group">
        <div className="list">
          <label className="row">
            <span className="row-main">
              <span className="row-title block">{t('shopSettings.price')}</span>
              <span className="row-sub block">{t('shopSettings.priceSub', { price: money(v?.priceMinor, org.currency, locale) })}</span>
            </span>
            <input className="t-body tnum text-right bg-transparent border-0 outline-none w-24 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }}
              inputMode="decimal" placeholder={t('product.samePrice')} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={t('shopSettings.price')} />
          </label>
        </div>
        <p className="inset-group-foot">{t('shopSettings.priceFoot')}</p>
      </section>
      ) : null}
      {canReorder ? (
      <section className="inset-group">
        <div className="list">
          <label className="row">
            <span className="row-main">
              <span className="row-title block">{t('shopSettings.reorder')}</span>
              <span className="row-sub block">{t('shopSettings.reorderSub', { now: qtyNumber(level.onHand, product.uom, locale) })}</span>
            </span>
            <input className="t-body tnum text-right bg-transparent border-0 outline-none w-24 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }}
              inputMode="decimal" placeholder={t('shopSettings.none')} value={reorder} onChange={(e) => setReorder(e.target.value)} aria-label={t('shopSettings.reorder')} />
          </label>
        </div>
        <p className="inset-group-foot">{t('shopSettings.reorderFoot')}</p>
      </section>
      ) : null}
    </Sheet>
  );
}
