// react-i18next on top of the shared messages in @custock/i18n (namespaces common and mobile).
// language: the user's choice, else the device, else english.

import { pickLocale, resources, type AppLocale } from '@custock/i18n';
import { getLocales } from 'expo-localization';
import i18next, { changeLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getItem, setItem } from './storage';

const KEY = 'custock.locale';

export function deviceLocale(): AppLocale {
  const tags = getLocales().map((l) => l.languageTag);
  return pickLocale(...tags);
}

// the default instance, shared with react-i18next
const instance = i18next;

void instance.use(initReactI18next).init({
  lng: deviceLocale(),
  fallbackLng: 'en',
  resources: resources as unknown as Record<string, Record<string, object>>,
  ns: ['common', 'mobile'],
  defaultNS: 'mobile',
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
} as Parameters<typeof i18next.init>[0]);

export async function restoreLocale(): Promise<void> {
  const saved = await getItem(KEY);
  if (saved) await changeLanguage(pickLocale(saved));
}

export async function setLocale(locale: AppLocale): Promise<void> {
  await setItem(KEY, locale);
  await changeLanguage(locale);
}

export function currentLocale(): AppLocale {
  return pickLocale(i18next.language);
}

export default i18next;
