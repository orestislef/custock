import { cookies, headers } from 'next/headers';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';

// chosen language from the cookie, then the browser, then english
export async function getLocale(): Promise<AppLocale> {
  const cookie = (await cookies()).get('locale')?.value;
  const accept = (await headers()).get('accept-language') ?? '';
  const browser = accept.split(',').map((part) => part.split(';')[0]?.trim());
  return pickLocale(cookie, ...browser);
}

export async function getT() {
  const locale = await getLocale();
  return { t: translator(locale, 'web'), locale };
}
