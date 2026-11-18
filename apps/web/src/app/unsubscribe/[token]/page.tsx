import { getT } from '@/lib/i18n-server';
import { serverApi } from '@/lib/api-server';
import { PublicShell } from '@/components/public/public-shell';
import { IconWarning } from '@/components/ui/icons';
import { UnsubscribeForm } from './unsubscribe-form';
import { devBuild } from '@/lib/env';

export const metadata = { robots: { index: false } };

// opened from the link in every email. a GET only shows this page, the change needs the button,
// so email security scanners that open links do not unsubscribe people by accident.
export default async function UnsubscribePage({ params, searchParams }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { api, mode } = await serverApi(locale);
  const info = mode === 'real' ? await api.unsubscribePage(token).catch(() => null) : null;
  // the sample shop only while developing without the api
  if (mode === 'real' && !info) {
    // an unknown, old or broken link: say so, never show a form for nothing
    return (
      <PublicShell orgName="Custock" t={t} brand>
        <div className="card p-6 text-center mt-6 page-in">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}>
            <IconWarning size={26} />
          </span>
          <h1 className="t-title3 m-0">{t('confirm.failTitle')}</h1>
          <p className="t-body t-2 mt-2 mb-0">{t('unsubscribe.failBody')}</p>
        </div>
      </PublicShell>
    );
  }
  // names from the address only while developing without the api, never in production
  const shop = info?.scopeName ?? (devBuild ? (typeof sp.shop === 'string' ? sp.shop : 'Lemoni Kifisia') : '');
  const org = info?.orgName ?? (devBuild ? (typeof sp.org === 'string' ? sp.org : 'Lemoni') : 'Custock');
  return (
    <PublicShell orgName={org} t={t}>
      <h1 className="t-title1 t-display m-0 mt-4">{t('unsubscribe.title')}</h1>
      <p className="t-body t-2 mt-3 mb-6">{t('unsubscribe.lead')}</p>
      <UnsubscribeForm token={token} shop={shop} org={org} />
    </PublicShell>
  );
}
