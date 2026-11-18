import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { IconCheck, IconWarning } from '@/components/ui/icons';
import Link from 'next/link';
import { defaultOrgSlug } from '@/lib/env';

export const metadata = { robots: { index: false } };

export default async function ConfirmPage({ params }: PageProps<'/confirm/[token]'>) {
  const { token } = await params;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const result = await api.confirmJoin(token).catch(() => null);
  // the business's own app, where its news, offers and alerts live from now on
  const slug = (result as { orgSlug?: string } | null)?.orgSlug ?? defaultOrgSlug();

  return (
    <PublicShell orgName={result?.orgName ?? 'Custock'} t={t}>
      <div className="card p-7 text-center mt-6 page-in">
        {result ? (
          <>
            <span className="inline-grid place-items-center w-16 h-16 rounded-full mb-4" style={{ background: 'color-mix(in srgb, var(--c-success) 14%, transparent)', color: 'var(--c-success)' }}>
              <IconCheck size={32} />
            </span>
            <h1 className="t-title1 t-display m-0">{t('confirm.title')}</h1>
            <p className="t-body t-2 mt-3 mb-0">{t('confirm.body', { scope: result.scopeName })}</p>
            {slug ? (
              <>
                <Link href={`/s/${slug}/me`} className="btn btn-primary btn-large mt-6">{t('confirm.open', { org: result.orgName })}</Link>
                <p className="t-foot t-2 mt-3 mb-0">{t('confirm.app', { org: result.orgName })}</p>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="inline-grid place-items-center w-16 h-16 rounded-full mb-4" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}>
              <IconWarning size={30} />
            </span>
            <h1 className="t-title2 m-0">{t('confirm.failTitle')}</h1>
            <p className="t-body t-2 mt-3 mb-0">{t('confirm.failBody')}</p>
          </>
        )}
      </div>
    </PublicShell>
  );
}
