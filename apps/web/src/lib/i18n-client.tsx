'use client';

import { createContext, startTransition, use, useContext, useEffect, useMemo, useState } from 'react';
import { clientMessages, clientTranslator, type AppLocale, type TFunction } from '@custock/i18n/client';

// only the reader's language is downloaded (see packages/i18n/src/client.ts). start fetching it as
// soon as this file runs, before the first render asks for it
if (typeof document !== 'undefined') {
  const lang = document.documentElement.lang;
  if (lang === 'en' || lang === 'el' || lang === 'ru') void clientMessages(lang);
}

const LocaleContext = createContext<AppLocale>('en');
const TContext = createContext<TFunction | null>(null);

const demo = process.env.NEXT_PUBLIC_DEMO === '1';
const LOCALE_EVENT = 'custock:locale';

function cookieLocale(): AppLocale | null {
  const v = /(?:^|;\s*)locale=(en|el|ru)\b/.exec(document.cookie)?.[1];
  return (v as AppLocale | undefined) ?? null;
}

export function I18nProvider({ locale: served, children }: { locale: AppLocale; children: React.ReactNode }) {
  // the public demo is static english html: the language picked is applied in the browser after
  // hydration, in a transition (the english screen stays until the other language has arrived),
  // and again on every switch
  const [picked, setPicked] = useState<AppLocale | null>(null);
  useEffect(() => {
    if (!demo) return;
    const read = () => {
      const next = cookieLocale();
      if (next) void clientMessages(next).then(() => startTransition(() => setPicked(next)));
    };
    queueMicrotask(read);
    window.addEventListener(LOCALE_EVENT, read);
    return () => window.removeEventListener(LOCALE_EVENT, read);
  }, []);
  const locale = (demo && picked) || served;
  // waits for the language file once (hydration keeps the server html meanwhile); a language switch
  // runs in a transition, so the old screen stays until the new language has arrived
  const messages = use(clientMessages(locale));
  const t = useMemo(() => clientTranslator(locale, messages), [locale, messages]);
  return (
    <LocaleContext.Provider value={locale}>
      <TContext.Provider value={t}>{children}</TContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): AppLocale {
  return useContext(LocaleContext);
}

export function useT(): TFunction {
  const t = useContext(TContext);
  if (!t) throw new Error('useT outside I18nProvider');
  return t;
}

export function setLocaleCookie(locale: AppLocale) {
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  if (demo) window.dispatchEvent(new Event(LOCALE_EVENT));
}
