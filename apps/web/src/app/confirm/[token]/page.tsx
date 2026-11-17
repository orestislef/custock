import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { IconCheck, IconWarning } from '@/components/ui/icons';

export const metadata = { robots: { index: false } };

export default async function ConfirmPage({ params }: PageProps<'/confirm/[token]'>) {
  const { token } = await params;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const result = await api.confirmJoin(token).catch(() => null);

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
            <div className="tip mt-6 text-left"><span className="t-sub">{t('confirm.app')}</span></div>
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
