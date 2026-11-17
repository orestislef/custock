import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { ProductView } from '@/components/public/product-view';

// the shelf QR lands here. the staff app reads the same code as a stock look up.
export async function generateMetadata({ params }: PageProps<'/p/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const { locale } = await getT();
  const { api } = await serverApi(locale);
  const p = await api.shelfProduct(code).catch(() => null);
  return { title: p ? `${p.name} · ${p.orgName}` : 'Custock' };
}

export default async function ShelfProductPage({ params, searchParams }: PageProps<'/p/[code]'>) {
  const { code } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const p = await api.shelfProduct(code).catch(() => null);
  if (!p) notFound();

  // a poster QR can carry the shop's join code, so "notify me" and "join" land on the right shop
  const joinCode = typeof sp.j === 'string' ? sp.j : process.env.CUSTOCK_DEFAULT_JOIN_CODE ?? 'ig4m8x';
  const joinHref = `/j/${encodeURIComponent(joinCode)}`;
  const notifyHref = `${joinHref}?notify=${encodeURIComponent(p.name)}`;

  return (
    <PublicShell orgName={p.orgName} t={t}>
      <ProductView p={p} t={t} locale={locale} joinHref={joinHref} notifyHref={notifyHref} />
    </PublicShell>
  );
}
