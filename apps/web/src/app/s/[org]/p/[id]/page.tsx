import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { orgInfo, publicProductById } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { ProductView } from '@/components/public/product-view';
import { FollowerProduct, ProductActions } from '@/components/shopper/product-actions';
import { Gone } from '@/components/ui/gone';

export async function generateMetadata({ params }: PageProps<'/s/[org]/p/[id]'>): Promise<Metadata> {
  const { org, id } = await params;
  const { locale } = await getT();
  const p = await publicProductById(org, id, locale);
  return p ? { title: p.name } : {};
}

export default async function CatalogProductPage({ params }: PageProps<'/s/[org]/p/[id]'>) {
  const { org, id } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  const joinHref = info.joinCode ? `/j/${info.joinCode}` : null;
  const p = await publicProductById(org, id, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t} back={{ href: `/s/${org}`, label: t('catalog.title') }}>
      {p ? <ProductView p={p} t={t} locale={locale} actions={<ProductActions p={p} joinHref={joinHref} />} />
        // the catalog is open to everyone, so a missing product is really gone
        : info.catalogShared ? <Gone title={t('gone.shopProduct.title')} body={t('gone.shopProduct.body', { org: info.name })} href={`/s/${org}`} cta={t('gone.shopProduct.cta', { org: info.name })} />
        : <FollowerProduct id={id} joinHref={joinHref} />}
    </PublicShell>
  );
}
