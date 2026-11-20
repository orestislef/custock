import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { orgInfo } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { CustomerOrder } from '@/components/shopper/customer-order';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('orders.oneTitle') };
}

// one order, the page a push about it opens
export default async function CustomerOrderPage({ params }: PageProps<'/s/[org]/orders/[id]'>) {
  const { org, id } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t} back={{ href: `/s/${org}/orders`, label: t('orders.mineTitle') }}>
      <CustomerOrder id={id} />
    </PublicShell>
  );
}
