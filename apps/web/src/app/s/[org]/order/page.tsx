import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { OrderCart } from '@/components/shopper/order-cart';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('orders.cartTitle') };
}

// the order being put together on this phone, then sent (thinking/19-orders.md)
export default async function OrderCartPage({ params }: PageProps<'/s/[org]/order'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t} back={{ href: `/s/${org}`, label: t('catalog.title') }}>
      <h1 className="t-large t-display m-0 mb-4">{t('orders.cartTitle')}</h1>
      <OrderCart />
    </PublicShell>
  );
}
