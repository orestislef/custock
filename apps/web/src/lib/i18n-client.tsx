'use client';

import { createContext, useContext, useMemo } from 'react';
import { translator, type AppLocale, type TFunction } from '@custock/i18n';

const LocaleContext = createContext<AppLocale>('en');

export function I18nProvider({ locale, children }: { locale: AppLocale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): AppLocale {
  return useContext(LocaleContext);
}

export function useT(): TFunction {
  const locale = useLocale();
  return useMemo(() => translator(locale, 'web'), [locale]);
}

export function setLocaleCookie(locale: AppLocale) {
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}
