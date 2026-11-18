import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { AccountView } from '@/components/shopper/account-view';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('shopper.me.title') };
}

export default async function MePage({ params }: PageProps<'/s/[org]/me'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t}>
      <h1 className="t-large t-display m-0 mb-4">{t('shopper.me.title')}</h1>
      <AccountView />
    </PublicShell>
  );
}
