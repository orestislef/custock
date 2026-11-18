import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getT } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { NewsView } from '@/components/shopper/news-view';
import { CustomerPushCard } from '@/components/shopper/push-card';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('shopper.news.title') };
}

export default async function NewsPage({ params }: PageProps<'/s/[org]/news'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t}>
      <h1 className="t-large t-display m-0 mb-4">{t('shopper.news.title')}</h1>
      <CustomerPushCard className="mb-4" />
      <Suspense><NewsView /></Suspense>
    </PublicShell>
  );
}
