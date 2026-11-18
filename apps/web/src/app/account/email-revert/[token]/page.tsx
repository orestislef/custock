import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { EmailRevertForm } from './revert-form';

export const metadata = { robots: { index: false } };

// opened from the notice sent to the old address after a login email change. a GET only shows the
// question, the change needs the button.
export default async function EmailRevertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getT();
  return (
    <PublicShell orgName="Custock" t={t}>
      <h1 className="t-title1 t-display m-0 mt-4">{t('emailRevert.title')}</h1>
      <p className="t-body t-2 mt-3 mb-6">{t('emailRevert.lead')}</p>
      <EmailRevertForm token={token} />
    </PublicShell>
  );
}
