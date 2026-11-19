import { cookies, headers } from 'next/headers';
import { pickLocale, translator, type AppLocale } from '@custock/i18n';

// chosen language from the cookie, then the browser, then english
export async function getLocale(): Promise<AppLocale> {
  // the public demo is static html: english on the server, the browser switches (lib/i18n-client)
  if (process.env.NEXT_PUBLIC_DEMO === '1') return 'en';
  const cookie = (await cookies()).get('locale')?.value;
  const accept = (await headers()).get('accept-language') ?? '';
  const browser = accept.split(',').map((part) => part.split(';')[0]?.trim());
  return pickLocale(cookie, ...browser);
}

export async function getT() {
  const locale = await getLocale();
  return { t: translator(locale, 'web'), locale };
}
