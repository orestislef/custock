import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { ProductView } from '@/components/public/product-view';

export async function generateMetadata({ params }: PageProps<'/s/[org]/p/[id]'>): Promise<Metadata> {
  const { org, id } = await params;
  const { api } = await serverApi();
  const p = await api.publicProduct(org, id).catch(() => null);
  return { title: p ? `${p.name} · ${p.orgName}` : 'Custock' };
}

export default async function CatalogProductPage({ params }: PageProps<'/s/[org]/p/[id]'>) {
  const { org, id } = await params;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const p = await api.publicProduct(org, id).catch(() => null);
  if (!p) notFound();
  const joinHref = `/j/${process.env.CUSTOCK_DEFAULT_JOIN_CODE ?? 'ig4m8x'}`;
  return (
    <PublicShell orgName={p.orgName} t={t} back={{ href: `/s/${org}`, label: t('catalog.title') }}>
      <ProductView p={p} t={t} locale={locale} joinHref={joinHref} notifyHref={`${joinHref}?notify=${encodeURIComponent(p.name)}`} />
    </PublicShell>
  );
}
