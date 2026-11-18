'use client';

// a category's name in the business language, and optionally in the other two, plus its picture:
// one of the built in icons or its own photo. used for a new category from the product form and
// for renaming on the categories screen.

import { useRef, useState } from 'react';
import { CATEGORY_ICON_KEYS, isCategoryIconKey, type Category, type CategoryInput, type Locale } from '@custock/core';
import { Sheet } from '@/components/ui/client-kit';
import { CategoryIcon, CategoryPicture } from '@/components/ui/category-picture';
import { IconTag } from '@/components/ui/icons';
import { uploadCategoryPhoto } from '@/lib/upload';
import { useAdmin } from './admin-context';
import { cleanLine } from '@custock/core';

const LOCALES: Locale[] = ['el', 'en', 'ru'];
const PLAIN = { minHeight: 36, padding: 0 } as const;

// arrows move between the icons like any group of radio buttons, Home and End to the ends
function moveFocus(e: React.KeyboardEvent<HTMLDivElement>) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  let next = at;
  if (e.key in keys) next = (at + keys[e.key]! + items.length) % items.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else return;
  e.preventDefault();
  items[next]!.focus();
}

// what the picture is in the sheet: what the category has, or what the person picked here
type Picture = { iconKey: string | null; imageUrl: string | null; imageFileId?: string | null; changed: boolean };

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
  const [picture, setPicture] = useState<Picture>({ iconKey: null, imageUrl: null, changed: false });
  const [icons, setIcons] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // the fields start from the category each time the sheet opens
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? category?.id ?? 'new' : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setError(null);
      setIcons(false);
      setNames(category ? { ...(category.names ?? {}), [base]: category.names?.[base] ?? category.name } : {});
      setPicture({ iconKey: category?.iconKey ?? null, imageUrl: category?.imageUrl ?? null, changed: false });
    }
  }

  const main = (names[base] ?? '').trim();
  const namesChanged = !category || LOCALES.some((l) => (names[l] ?? '').trim() !== ((l === base ? category.names?.[l] ?? category.name : category.names?.[l]) ?? ''));
  const valid = main.length > 0 && main.length <= 80 && (namesChanged || picture.changed) && !uploading;
  const hasPicture = !!(picture.imageUrl || picture.iconKey);

  const pickIcon = (iconKey: string) => {
    setPicture({ iconKey, imageUrl: null, imageFileId: undefined, changed: true });
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f || !org) return;
    setUploading(true);
    setError(null);
    try {
      const r = await uploadCategoryPhoto(api, org.orgId, f);
      setPicture({ iconKey: null, imageUrl: r.url, imageFileId: r.fileId, changed: true });
      setIcons(false);
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'upload_failed'}`));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const removePicture = () => setPicture({ iconKey: null, imageUrl: null, imageFileId: null, changed: true });

  const save = async () => {
    if (!org || !valid || busy) return;
    setBusy(true);
    setError(null);
    const translations = Object.fromEntries(others.map((l) => [l, cleanLine(names[l] ?? '') || null]));
    // a new photo wins, then an icon, and nothing at all clears both
    const pic: Pick<CategoryInput, 'iconKey' | 'imageFileId'> = !picture.changed
      ? {}
      : picture.imageFileId ? { imageFileId: picture.imageFileId }
        : picture.iconKey ? { iconKey: picture.iconKey as CategoryInput['iconKey'] }
          : { iconKey: null, imageFileId: null };
    try {
      const saved = category
        ? await api.updateCategory(org.orgId, category.id, { name: main, translations, ...pic })
        : await api.createCategory(org.orgId, { name: main, translations, ...pic });
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
                  <input id={`cat-${l}`} className="field pt-1" maxLength={80} value={names[l] ?? ''} data-autofocus={i === 0 ? "" : undefined} autoComplete="off" autoCapitalize="words"
                    autoCorrect="off" spellCheck={false} enterKeyHint={i < 2 ? 'next' : 'done'}
                    onBlur={() => setNames((x) => ({ ...x, [l]: cleanLine(x[l] ?? '') }))}
                    placeholder={l === base ? undefined : t('categories.optional')}
                    onChange={(e) => setNames((x) => ({ ...x, [l]: e.target.value }))} />
                </label>
              </li>
            ))}
          </ul>
          <p className="inset-group-foot">{t('categories.foot')}</p>
        </section>

        <section className="inset-group" aria-labelledby="cat-picture">
          <div className="list">
            <div className="row" style={{ paddingTop: 12, paddingBottom: 12 }}>
              {hasPicture ? (
                <CategoryPicture iconKey={picture.iconKey} imageUrl={picture.imageUrl} size={52} />
              ) : (
                <span aria-hidden="true" className="inline-grid place-items-center flex-none" style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--c-fill)', color: 'var(--c-ink-3)' }}>
                  <IconTag size={24} />
                </span>
              )}
              <span className="row-main min-w-0">
                <span id="cat-picture" className="row-title block">{t('categories.picture')}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  <button type="button" className="btn btn-plain" style={PLAIN} aria-expanded={icons} aria-controls="cat-icons" onClick={() => setIcons((v) => !v)}>
                    {icons ? t('categories.hideIcons') : t('categories.chooseIcon')}
                  </button>
                  <button type="button" className="btn btn-plain" style={PLAIN} disabled={uploading} onClick={() => file.current?.click()}>
                    {uploading ? t('categories.uploading') : picture.imageUrl ? t('categories.changePhoto') : t('categories.addPhoto')}
                  </button>
                  {hasPicture ? <button type="button" className="btn btn-plain" style={{ ...PLAIN, color: 'var(--c-error)' }} onClick={removePicture}>{t('categories.removePicture')}</button> : null}
                </span>
              </span>
              <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            </div>
            {icons ? (
              <div id="cat-icons" role="radiogroup" aria-label={t('categories.iconsLabel')} className="cat-icon-grid row-sep relative" onKeyDown={moveFocus}>
                {CATEGORY_ICON_KEYS.map((k, i) => {
                  const on = !picture.imageUrl && picture.iconKey === k;
                  const chosen = !picture.imageUrl && isCategoryIconKey(picture.iconKey);
                  return (
                    <button key={k} type="button" role="radio" aria-checked={on} tabIndex={on || (!chosen && i === 0) ? 0 : -1} aria-label={t(`categories.icon.${k}`)} title={t(`categories.icon.${k}`)}
                      className="cat-icon-choice" data-on={on ? '' : undefined} onClick={() => pickIcon(k)}>
                      <CategoryIcon iconKey={k} size={24} />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <p className="inset-group-foot">{t('categories.pictureFoot')}</p>
        </section>
      </form>
    </Sheet>
  );
}
