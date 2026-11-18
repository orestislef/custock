// the languages and helpers that carry no texts, safe to import anywhere (the browser too)

export const LOCALES = ['en', 'el', 'ru'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const NAMESPACES = ['common', 'server', 'web'] as const;
export type Namespace = (typeof NAMESPACES)[number];

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
