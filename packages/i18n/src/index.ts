// shared translations for app, web and server. english, greek, russian.
// format: i18next json v4. plurals use suffixes (_one, _few, _many, _other) resolved with
// Intl.PluralRules, so russian gets one/few/many and greek one/other.
//
// namespaces and who owns them:
//   common  shared words: roles, permissions, stock states, units, errors, kinds
//   server  push, email and join page texts built on the server
//   web     the next.js app

import i18next, { type i18n as I18n, type TFunction } from 'i18next';

import enCommon from './locales/en/common.json';
import elCommon from './locales/el/common.json';
import ruCommon from './locales/ru/common.json';
import enServer from './locales/en/server.json';
import elServer from './locales/el/server.json';
import ruServer from './locales/ru/server.json';
import enWeb from './locales/en/web.json';
import elWeb from './locales/el/web.json';
import ruWeb from './locales/ru/web.json';

export const LOCALES = ['en', 'el', 'ru'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const NAMESPACES = ['common', 'server', 'web'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources = {
  en: { common: enCommon, server: enServer, web: enWeb },
  el: { common: elCommon, server: elServer, web: elWeb },
  ru: { common: ruCommon, server: ruServer, web: ruWeb },
} as const;

export const LOCALE_NAMES: Record<AppLocale, string> = { en: 'English', el: 'Ελληνικά', ru: 'Русский' };

// fallback chain from thinking/11-languages.md: chosen, device, org default, english
export function pickLocale(...candidates: (string | null | undefined)[]): AppLocale {
  for (const c of candidates) {
    if (!c) continue;
    const base = c.toLowerCase().split(/[-_]/)[0];
    if ((LOCALES as readonly string[]).includes(base!)) return base as AppLocale;
  }
  return 'en';
}

// a fresh, isolated instance. use one per request on the server, one per app on clients.
export function createI18n(locale: AppLocale, defaultNS: Namespace = 'common'): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    resources: resources as unknown as Record<string, Record<string, object>>,
    ns: [...NAMESPACES],
    defaultNS,
    initImmediate: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  } as Parameters<I18n['init']>[0]);
  return instance;
}

const cache = new Map<string, TFunction>();

// quick translator for server side code: t('el', 'server', 'push.backInStock.title', { shop })
export function translator(locale: AppLocale, ns: Namespace = 'common'): TFunction {
  const key = `${locale}:${ns}`;
  let t = cache.get(key);
  if (!t) {
    t = createI18n(locale, ns).getFixedT(locale, ns);
    cache.set(key, t);
  }
  return t;
}

export type { TFunction, I18n };
