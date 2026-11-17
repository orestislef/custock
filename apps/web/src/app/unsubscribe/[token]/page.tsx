import { getT } from '@/lib/i18n-server';
import { serverApi } from '@/lib/api-server';
import { PublicShell } from '@/components/public/public-shell';
import { UnsubscribeForm } from './unsubscribe-form';

export const metadata = { robots: { index: false } };

// opened from the link in every email. a GET only shows this page, the change needs the button,
// so email security scanners that open links do not unsubscribe people by accident.
export default async function UnsubscribePage({ params, searchParams }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { api, mode } = await serverApi(locale);
  const info = mode === 'real' ? await api.unsubscribePage(token).catch(() => null) : null;
  const shop = info?.scopeName ?? (typeof sp.shop === 'string' ? sp.shop : 'Lemoni Kifisia');
  const org = info?.orgName ?? (typeof sp.org === 'string' ? sp.org : 'Lemoni');
  return (
    <PublicShell orgName={org} t={t}>
      <h1 className="t-title1 t-display m-0 mt-4">{t('unsubscribe.title')}</h1>
      <p className="t-body t-2 mt-3 mb-6">{t('unsubscribe.lead')}</p>
      <UnsubscribeForm token={token} shop={shop} org={org} />
    </PublicShell>
  );
}
