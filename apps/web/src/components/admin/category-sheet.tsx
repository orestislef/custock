'use client';

// a category's name in the business language, and optionally in the other two. used for a new
// category from the product form and for renaming on the categories screen.

import { useState } from 'react';
import type { Category, Locale } from '@custock/core';
import { Sheet } from '@/components/ui/client-kit';
import { useAdmin } from './admin-context';
import { cleanLine } from '@custock/core';

const LOCALES: Locale[] = ['el', 'en', 'ru'];

export function CategorySheet({ open, onClose, category, onSaved }: {
  open: boolean;
  onClose: () => void;
  category?: Category | null;
  onSaved: (c: Category) => void;
}) {
  const { api, org, t, settings } = useAdmin();
  const base = (settings?.defaultLocale ?? 'el') as Locale;
  const others = LOCALES.filter((l) => l !== base);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the fields start from the category each time the sheet opens
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? category?.id ?? 'new' : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setError(null);
      setNames(category ? { ...(category.names ?? {}), [base]: category.names?.[base] ?? category.name } : {});
    }
  }

  const main = (names[base] ?? '').trim();
  const changed = !category || LOCALES.some((l) => (names[l] ?? '').trim() !== ((l === base ? category.names?.[l] ?? category.name : category.names?.[l]) ?? ''));
  const valid = main.length > 0 && main.length <= 80 && changed;

  const save = async () => {
    if (!org || !valid || busy) return;
    setBusy(true);
    setError(null);
    const translations = Object.fromEntries(others.map((l) => [l, cleanLine(names[l] ?? '') || null]));
    try {
      const saved = category
        ? await api.updateCategory(org.orgId, category.id, { name: main, translations })
        : await api.createCategory(org.orgId, { name: main, translations });
      onSaved(saved);
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'conflict' ? t('categories.taken') : t(`common:error.${code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={category ? t('categories.rename') : t('categories.new')} error={error}
      footer={<>
        <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>{category ? t('common:action.save') : t('categories.create')}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <section className="inset-group">
          <ul className="list" role="list">
            {[base, ...others].map((l, i) => (
              <li key={l}>
                <label htmlFor={`cat-${l}`} className={`block ${i ? 'row-sep relative' : ''}`}>
                  <span className="field-label">{l === base ? t('categories.name') : t(`categories.nameIn.${l}`)}</span>
                  <input id={`cat-${l}`} className="field pt-1" maxLength={80} value={names[l] ?? ''} autoFocus={i === 0} autoComplete="off" autoCapitalize="words"
                    onBlur={() => setNames((x) => ({ ...x, [l]: cleanLine(x[l] ?? '') }))}
                    placeholder={l === base ? undefined : t('categories.optional')}
                    onChange={(e) => setNames((x) => ({ ...x, [l]: e.target.value }))} />
                </label>
              </li>
            ))}
          </ul>
          <p className="inset-group-foot">{t('categories.foot')}</p>
        </section>
      </form>
    </Sheet>
  );
}
