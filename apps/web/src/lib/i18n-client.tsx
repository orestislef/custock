'use client';

import { createContext, use, useContext, useMemo } from 'react';
import { clientMessages, clientTranslator, type AppLocale, type TFunction } from '@custock/i18n/client';

// only the reader's language is downloaded (see packages/i18n/src/client.ts). start fetching it as
// soon as this file runs, before the first render asks for it
if (typeof document !== 'undefined') {
  const lang = document.documentElement.lang;
  if (lang === 'en' || lang === 'el' || lang === 'ru') void clientMessages(lang);
}

const LocaleContext = createContext<AppLocale>('en');
const TContext = createContext<TFunction | null>(null);

export function I18nProvider({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
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
}
