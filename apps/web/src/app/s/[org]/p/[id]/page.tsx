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

// back goes to the part of the shop the product was opened from (?from=news, offers, me), else
// the catalog. only these known values, never an address from the query string
const FROM = { news: ['news', 'shopper.tabs.news'], offers: ['offers', 'shopper.tabs.offers'], me: ['me', 'shopper.tabs.you'] } as const;

export default async function CatalogProductPage({ params, searchParams }: PageProps<'/s/[org]/p/[id]'>) {
  const { org, id } = await params;
  const q = await searchParams;
  const { t, locale } = await getT();
  const from = typeof q.from === 'string' && q.from in FROM ? FROM[q.from as keyof typeof FROM] : null;
  const back = from ? { href: `/s/${org}/${from[0]}`, label: t(from[1]) } : { href: `/s/${org}`, label: t('catalog.title') };
  const info = await orgInfo(org, locale);
  const joinHref = info.joinCode ? `/j/${info.joinCode}` : null;
  const p = await publicProductById(org, id, locale);
  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t} back={back}>
      {p ? <ProductView p={p} t={t} locale={locale} actions={<ProductActions p={p} joinHref={joinHref} />} />
        // the catalog is open to everyone, so a missing product is really gone
        : info.catalogShared ? <Gone title={t('gone.shopProduct.title')} body={t('gone.shopProduct.body', { org: info.name })} href={`/s/${org}`} cta={t('gone.shopProduct.cta', { org: info.name })} />
        : <FollowerProduct id={id} joinHref={joinHref} />}
    </PublicShell>
  );
}
