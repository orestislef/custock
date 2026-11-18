import { getT } from '@/lib/i18n-server';
import { serverApi } from '@/lib/api-server';
import { PublicShell } from '@/components/public/public-shell';
import { IconWarning } from '@/components/ui/icons';
import { EmailRevertForm } from './revert-form';

export const metadata = { robots: { index: false } };

// opened from the notice sent to the old address after a login email change. a GET only shows the
// question, the change needs the button. a used or old link says so straight away.
export default async function EmailRevertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const valid = await api.emailRevertPreview(token).then(() => true, () => false);
  return (
    <PublicShell orgName="Custock" t={t} brand>
      {valid ? (
        <>
          <h1 className="t-title1 t-display m-0 mt-4">{t('emailRevert.title')}</h1>
          <p className="t-body t-2 mt-3 mb-6">{t('emailRevert.lead')}</p>
          <EmailRevertForm token={token} />
        </>
      ) : (
        <div className="card p-6 text-center mt-6 page-in">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}>
            <IconWarning size={26} />
          </span>
          <h1 className="t-title3 m-0">{t('emailRevert.failTitle')}</h1>
          <p className="t-body t-2 mt-2 mb-0">{t('emailRevert.failBody')}</p>
        </div>
      )}
    </PublicShell>
  );
}
