'use client';

// the person's own name, changed from the account sheet. a row that opens a small sheet with one
// field, so the name never changes by a stray tap.

import { useState } from 'react';
import { cleanLine, type CustockApi } from '@custock/core';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconChevronRight } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';

export function NameRow({ api, name, onSaved }: { api: CustockApi; name: string | null; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = value.trim().replace(/\s+/g, ' ');
  const valid = clean.length >= 1 && clean.length <= 80 && clean !== (name ?? '');

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMe({ displayName: clean });
      setOpen(false);
      onSaved();
      toast(t('admin.nameSaved'));
    } catch {
      setError(t('common:error.internal'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="row" onClick={() => { setValue(name ?? ''); setError(null); setOpen(true); }}>
        <span className="row-main row-title">{t('admin.name')}</span>
        <span className="t-body t-2 text-right min-w-0 truncate">{name}</span>
        <IconChevronRight size={16} className="chev" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('admin.changeName')} error={error}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setOpen(false)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{t('common:action.save')}</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="block">
            <span className="t-foot t-2 block mb-1">{t('admin.name')}</span>
            <input className="field" type="text" autoComplete="name" autoCapitalize="words" enterKeyHint="done" maxLength={80} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setValue((v) => cleanLine(v))} data-autofocus="" />
          </label>
          <p className="t-foot t-2 mt-2 mb-0">{t('admin.nameFoot')}</p>
        </form>
      </Sheet>
    </>
  );
}
