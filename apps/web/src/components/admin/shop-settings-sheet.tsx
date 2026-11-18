'use client';

// per shop: price override and reorder point. each field shows only for someone who may change it.

import { useState } from 'react';
import type { Product, StockLevel } from '@custock/core';
import { useAdmin } from './admin-context';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { money, qtyNumber } from '@/lib/format';
import { productName } from '@/lib/names';
import { checkAll, decimalExample, useMoneyField, useQtyField } from '@/lib/fields';
import { FieldMessage, FormNav } from '@/components/ui/field-kit';

export function ShopSettingsSheet({ product, level, onClose, onSaved }: { product: Product; level: StockLevel; onClose: () => void; onSaved: () => void }) {
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const shop = shops.find((s) => s.id === level.shopId);
  const v = product.variants.find((x) => x.id === level.variantId);
  const canPrice = can('prices.shop.edit', level.shopId);
  const canReorder = can('stock.settings.manage', level.shopId);
  const priceF = useMoneyField(null, locale);
  const reorderF = useQtyField(level.reorderPoint, product.uom, locale);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!checkAll([...(canPrice ? [priceF] : []), ...(canReorder ? [reorderF] : [])])) return;
    setBusy(true);
    try {
      const priceMinor = canPrice ? priceF.check() ?? undefined : undefined;
      const reorderPoint = canReorder ? reorderF.check() ?? null : null;
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
      <FormNav onDone={() => void save()} last="done">
      {canPrice ? (
      <section className="inset-group">
        <div className="list">
          <label className="row">
            <span className="row-main">
              <span className="row-title block">{t('shopSettings.price')}</span>
              <span className="row-sub block">{t('shopSettings.priceSub', { price: money(v?.priceMinor, org.currency, locale) })}</span>
            </span>
            <input className="t-body tnum text-right bg-transparent border-0 outline-none w-24 rounded-[8px] px-2 py-1" style={{ background: 'var(--c-fill)' }}
              placeholder={t('product.samePrice')} {...priceF.inputProps} aria-label={t('shopSettings.price')} />
          </label>
          <FieldMessage id={priceF.errorId} kind="money" error={priceF.error} params={{ example: decimalExample(locale) }} />
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
              placeholder={t('shopSettings.none')} {...reorderF.inputProps} aria-label={t('shopSettings.reorder')} />
          </label>
          <FieldMessage id={reorderF.errorId} kind="qty" error={reorderF.error} params={{ example: decimalExample(locale, product.uom === 'piece' ? 0 : 3) }} />
        </div>
        <p className="inset-group-foot">{t('shopSettings.reorderFoot')}</p>
      </section>
      ) : null}
      </FormNav>
    </Sheet>
  );
}
