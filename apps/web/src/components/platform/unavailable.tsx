// what customers see of a business that is paused, or whose customer pages are switched off:
// one calm line, nothing about why

import { getT } from '@/lib/i18n-server';

export const UNAVAILABLE_CODES = ['org_suspended', 'feature_off'];

export function isUnavailable(e: unknown): boolean {
  return UNAVAILABLE_CODES.includes((e as { code?: string } | null)?.code ?? '');
}

export async function Unavailable() {
  const { t } = await getT();
  return (
    <main className="min-h-dvh grid place-items-center px-safe-6 text-center">
      <div className="max-w-[420px] page-in">
        <p className="t-title2 m-0">{t('platform.unavailable.title')}</p>
        <p className="t-body t-2 mt-2 mb-0">{t('platform.unavailable.body')}</p>
      </div>
    </main>
  );
}
