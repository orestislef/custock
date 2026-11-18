'use client';

// a new business from the platform: its name, web address, first shop and the owner's email.
// the owner gets a "set your password" link, by email when mail is live, and here to share.

import { useEffect, useState } from 'react';
import type { BusinessCreated, Locale } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Picker, Sheet } from '@/components/ui/client-kit';
import { IconCheck } from '@/components/ui/icons';
import { basePath } from '@/lib/api-client';
import { LinkActions } from './bits';
import { cleanLine, isEmail, normalizeEmail, slugProblem } from '@custock/core';
import { EmailInput } from '@/components/ui/field-kit';

export function NewBusinessSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { api, t, locale } = usePlatform();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [shop, setShop] = useState('');
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<Locale>((['en', 'el', 'ru'].includes(locale) ? locale : 'el') as Locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BusinessCreated | null>(null);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) { setName(''); setSlug(''); setSlugTouched(false); setShop(''); setEmail(''); setError(null); setDone(null); setBusy(false); }
  }

  // the web address follows the name until it is edited by hand
  useEffect(() => {
    if (slugTouched || !name.trim()) return;
    const id = setTimeout(() => { void api.suggestSlug(name.trim()).then((r) => setSlug(r.slug), () => {}); }, 250);
    return () => clearTimeout(id);
  }, [api, name, slugTouched]);

  const valid = cleanLine(name) && !slugProblem(slug) && isEmail(email);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createBusiness({ name: cleanLine(name), slug, shopName: cleanLine(shop) || undefined, ownerEmail: normalizeEmail(email), locale: lang });
      setDone(r);
      onCreated();
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      setError(code === 'conflict' ? t('platform.new.slugTaken') : t(`common:error.${code}`));
    } finally {
      setBusy(false);
    }
  };

  const host = typeof window !== 'undefined' ? `${window.location.host}${basePath}/s/` : '/s/';

  return (
    <Sheet open={open} onClose={onClose} title={done ? t('platform.new.doneTitle') : t('platform.newBusiness')} error={error}
      footer={done ? (
        <button type="button" className="btn btn-primary" onClick={onClose}>{t('common:action.done')}</button>
      ) : (
        <>
          <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void create()}>{t('platform.new.create')}</button>
        </>
      )}>
      {done ? (
        <div className="flex flex-col gap-4">
          <span className="inline-grid place-items-center w-12 h-12 rounded-full" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}><IconCheck size={24} /></span>
          <p className="t-body m-0">{done.emailed ? t('platform.new.emailed', { email: email.trim() }) : t('platform.new.share', { email: email.trim() })}</p>
          <p className="t-foot t-2 m-0 break-all">{done.link}</p>
          <LinkActions link={done.link} t={t} title={t('platform.new.shareTitle', { name: name.trim() })} />
        </div>
      ) : (
        <>
          <div className="list mb-2">
            <label className="block">
              <span className="field-label">{t('platform.new.name')}</span>
              <input className="field pt-1" autoComplete="organization" autoCapitalize="words" enterKeyHint="next" maxLength={80} placeholder={t('platform.new.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName((v) => cleanLine(v))} />
            </label>
            <label className="block row-sep relative">
              <span className="field-label">{t('platform.new.slug')}</span>
              <input className="field pt-1" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={40} value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} />
            </label>
            <label className="block row-sep relative">
              <span className="field-label">{t('platform.new.shop')}</span>
              <input className="field pt-1" autoComplete="off" autoCapitalize="words" enterKeyHint="next" maxLength={80} placeholder={name.trim() || t('platform.new.shopPlaceholder')} value={shop} onChange={(e) => setShop(e.target.value)} onBlur={() => setShop((v) => cleanLine(v))} />
            </label>
          </div>
          <p className="t-foot t-2 m-0 mb-4 px-4 break-all">{t('platform.new.slugHint', { url: `${host}${slug || '...'}` })}</p>
          <div className="list mb-2">
            <label className="block">
              <span className="field-label">{t('platform.new.ownerEmail')}</span>
              <EmailInput value={email} onChange={setEmail} enterKeyHint="done" />
            </label>
            <div className="row row-sep">
              <span className="row-main row-title">{t('platform.new.language')}</span>
              <Picker label={t('platform.new.language')} value={lang} onChange={(v) => setLang(v as Locale)}
                options={[{ value: 'el', label: 'Ελληνικά' }, { value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }]} />
            </div>
          </div>
          <p className="t-foot t-2 m-0 px-4">{t('platform.new.ownerHint')}</p>
        </>
      )}
    </Sheet>
  );
}
