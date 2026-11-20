'use client';

// the business's shops in Settings: who may change a shop's details sees it here, who may add
// shops gets "Add shop" (not when the super admin's limit is reached; then the row is simply not
// there). saving updates the whole admin frame, so the shop picker, stock, scan, transfers and QR
// codes know the new shop at once.

import { useState } from 'react';
import type { Shop } from '@custock/core';
import { cleanLine, emptyWeek, LIMITS, ShopHours, WEEKDAYS } from '@custock/core';
import { HoursEditor } from './hours-editor';
import { useAdmin } from '@/components/admin/admin-context';
import { Group, IconTile, Row } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { FieldMessage, FormNav } from '@/components/ui/field-kit';
import { IconPlus, IconShop } from '@/components/ui/icons';
import { checkAll, useLineField, usePhoneField } from '@/lib/fields';

export function ShopsGroup({ shops, onChanged }: { shops: Shop[]; onChanged: (shop: Shop, created: boolean) => void }) {
  const { org, t, can } = useAdmin();
  const [editing, setEditing] = useState<Shop | 'new' | null>(null);
  const canOrg = can('org.settings.manage', null);
  const mine = shops.filter((sh) => canOrg || can('shop.settings.manage', sh.id));
  const canAdd = can('shops.create', null) && !org.shopsFull;
  if (!mine.length && !canAdd) return null;
  return (
    <>
      <Group title={t('settings.shops.title')} footer={t('settings.shops.foot')}>
        {mine.map((sh) => (
          <Row key={sh.id} leading={<IconTile><IconShop size={18} /></IconTile>} title={sh.name}
            subtitle={[sh.city, sh.address].filter(Boolean).join(' · ') || undefined}
            onClick={() => setEditing(sh)} label={t('settings.shops.editLabel', { shop: sh.name })} />
        ))}
        {canAdd ? (
          <button type="button" className="row has-icon" onClick={() => setEditing('new')} style={{ color: 'var(--c-accent)' }}>
            <IconTile><IconPlus size={18} /></IconTile>
            <span className="row-main row-title">{t('settings.shops.add')}</span>
          </button>
        ) : null}
      </Group>
      {editing ? (
        <ShopSheet key={editing === 'new' ? 'new' : editing.id} shop={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(shop, created) => { setEditing(null); onChanged(shop, created); }} />
      ) : null}
    </>
  );
}

function ShopSheet({ shop, onClose, onSaved }: { shop: Shop | null; onClose: () => void; onSaved: (shop: Shop, created: boolean) => void }) {
  const { api, org, t } = useAdmin();
  const toast = useToast();
  const nameF = useLineField(shop?.name ?? '', { max: LIMITS.shopName, required: true, capitalize: 'words' });
  const cityF = useLineField(shop?.city ?? '', { max: LIMITS.city, capitalize: 'words' });
  const addressF = useLineField(shop?.address ?? '', { max: LIMITS.address, capitalize: 'words' });
  const phoneF = usePhoneField(shop?.phone ?? '');
  const [week, setWeek] = useState<ShopHours['week']>(() => shop?.hours?.week ?? emptyWeek());
  const [note, setNote] = useState(shop?.hours?.note ?? '');
  // nothing set is no hours at all; anything else must read as opening hours to be saved
  const hoursEmpty = WEEKDAYS.every((d) => !week[d].length) && !cleanLine(note);
  const parsed = hoursEmpty ? null : ShopHours.safeParse({ week, note: cleanLine(note) || null });
  const hoursInvalid = !!parsed && !parsed.success;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy || !checkAll([nameF, cityF, addressF, phoneF]) || hoursInvalid) return;
    const hours = parsed?.success ? parsed.data : null;
    const name = nameF.check()!;
    const city = cityF.check() || null;
    const address = addressF.check() || null;
    const phone = phoneF.check() ?? null;
    setBusy(true);
    setError(null);
    try {
      const made = shop ? null : await api.createShop(org.orgId, { name, ...(city ? { city } : {}), ...(address ? { address } : {}), ...(phone ? { phone } : {}) });
      const saved = shop
        ? await api.updateShop(org.orgId, shop.id, { name, city, address, phone, hours })
        : hours ? await api.updateShop(org.orgId, made!.id, { hours }) : made!;
      toast(shop ? t('settings.saved') : t('settings.shops.added', { shop: saved.name }));
      onSaved(saved, !shop);
    } catch (e) {
      const fields = (e as { problem?: { fields?: Record<string, string> } }).problem?.fields ?? {};
      if (fields.name) nameF.setError(fields.name as never);
      if (fields.city) cityF.setError(fields.city as never);
      if (fields.address) addressF.setError(fields.address as never);
      if (fields.phone) phoneF.setError(fields.phone as never);
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`, { defaultValue: t('common:error.internal') }));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={shop ? t('settings.shops.editTitle') : t('settings.shops.newTitle')} error={error}
      footer={<>
        <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !nameF.text.trim() || hoursInvalid} onClick={() => void save()}>
          {shop ? t('common:action.save') : t('settings.shops.addButton')}
        </button>
      </>}>
      <FormNav onDone={() => void save()} last="done" className="list mb-2">
        <label className="block" htmlFor={nameF.id}>
          <span className="field-label">{t('settings.shops.name')}</span>
          <input className="field pt-1" {...nameF.inputProps} autoComplete="off" data-autofocus />
        </label>
        <FieldMessage id={nameF.errorId} kind="line" error={nameF.error} params={{ max: LIMITS.shopName }} />
        <label className="block row-sep relative" htmlFor={cityF.id}>
          <span className="field-label">{t('settings.shops.city')}</span>
          <input className="field pt-1" {...cityF.inputProps} autoComplete="address-level2" />
        </label>
        <FieldMessage id={cityF.errorId} kind="line" error={cityF.error} params={{ max: LIMITS.city }} />
        <label className="block row-sep relative" htmlFor={addressF.id}>
          <span className="field-label">{t('settings.shops.address')}</span>
          <input className="field pt-1" {...addressF.inputProps} autoComplete="street-address" />
        </label>
        <FieldMessage id={addressF.errorId} kind="line" error={addressF.error} params={{ max: LIMITS.address }} />
        <label className="block row-sep relative" htmlFor={phoneF.id}>
          <span className="field-label">{t('settings.shops.phone')}</span>
          <input className="field pt-1" {...phoneF.inputProps} />
        </label>
        <FieldMessage id={phoneF.errorId} kind="phone" error={phoneF.error} />
      </FormNav>
      <p className="t-foot t-2 m-0 px-4">{shop ? t('settings.shops.editFoot') : t('settings.shops.newFoot')}</p>
      <HoursEditor week={week} note={note} onWeek={setWeek} onNote={setNote} invalid={hoursInvalid} />
    </Sheet>
  );
}
