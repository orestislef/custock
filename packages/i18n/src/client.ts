// the browser side: only the reader's own language is downloaded, as its own file, and only the
// namespaces the web uses (common and web). the server texts (emails, push) never reach the browser.

import i18next, { type TFunction } from 'i18next';
import type { AppLocale } from './meta';

export * from './meta';
export type { TFunction };

export interface ClientMessages { common: object; web: object }

// one file per language, so a greek reader never downloads russian or english
function fetchMessages(locale: AppLocale): Promise<ClientMessages> {
  if (locale === 'el') return Promise.all([import('./locales/el/common.json'), import('./locales/el/web.json')]).then(([c, w]) => ({ common: c.default, web: w.default }));
  if (locale === 'ru') return Promise.all([import('./locales/ru/common.json'), import('./locales/ru/web.json')]).then(([c, w]) => ({ common: c.default, web: w.default }));
  return Promise.all([import('./locales/en/common.json'), import('./locales/en/web.json')]).then(([c, w]) => ({ common: c.default, web: w.default }));
}

// one promise per language, shaped like the promises React itself tracks, so use() reads a language
// that has arrived without waiting. a failed download is forgotten, the next render tries again
type Tracked<T> = Promise<T> & { status?: string; value?: T; reason?: unknown };
const loading = new Map<AppLocale, Tracked<ClientMessages>>();

export function clientMessages(locale: AppLocale): Promise<ClientMessages> & { value?: ClientMessages } {
  let p = loading.get(locale);
  if (!p) {
    p = fetchMessages(locale) as Tracked<ClientMessages>;
    p.status = 'pending';
    p.then(
      (v) => { p!.status = 'fulfilled'; p!.value = v; },
      (e) => { p!.status = 'rejected'; p!.reason = e; loading.delete(locale); },
    );
    loading.set(locale, p);
  }
  return p;
}

const translators = new Map<AppLocale, TFunction>();

// a translator for the web namespace (common: keys work as in the server translator)
export function clientTranslator(locale: AppLocale, messages: ClientMessages): TFunction {
  let t = translators.get(locale);
  if (!t) {
    const instance = i18next.createInstance();
    void instance.init({
      lng: locale,
      fallbackLng: false,
      resources: { [locale]: { common: messages.common, web: messages.web } } as Record<string, Record<string, object>>,
      ns: ['common', 'web'],
      defaultNS: 'web',
      initImmediate: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    } as Parameters<typeof instance.init>[0]);
    t = instance.getFixedT(locale, 'web');
    translators.set(locale, t);
  }
  return t;
}
