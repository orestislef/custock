import type { Metadata } from 'next';
import { ShopperProvider } from '@/components/shopper/shopper-context';
import { ShopperTabs } from '@/components/shopper/shopper-tabs';
import { getLocale } from '@/lib/i18n-server';
import { orgAppMetadata } from '@/lib/manifests';
import { orgInfo } from '@/lib/storefront';
import { Unavailable } from '@/components/platform/unavailable';

// everything under /s/<org> is that business's own home screen app for its customers
export async function generateMetadata({ params }: LayoutProps<'/s/[org]'>): Promise<Metadata> {
  const { org } = await params;
  const info = await orgInfo(org, await getLocale());
  return { ...orgAppMetadata(org, info.name), title: { default: info.name, template: `%s · ${info.name}` } };
}

export default async function OrgLayout({ children, params }: LayoutProps<'/s/[org]'>) {
  const { org } = await params;
  const info = await orgInfo(org, await getLocale());
  if (info.unavailable) return <Unavailable />;
  return (
    <ShopperProvider slug={org} orgName={info.name} joinCode={info.joinCode}>
      {children}
      <ShopperTabs />
    </ShopperProvider>
  );
}
