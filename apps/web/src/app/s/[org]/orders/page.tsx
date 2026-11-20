import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { MyOrders } from '@/components/shopper/my-orders';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('orders.mineTitle') };
}

export default async function MyOrdersPage({ params }: PageProps<'/s/[org]/orders'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t} back={{ href: `/s/${org}/me`, label: t('shopper.tabs.you') }}>
      <h1 className="t-large t-display m-0 mb-4">{t('orders.mineTitle')}</h1>
      <MyOrders />
    </PublicShell>
  );
}
