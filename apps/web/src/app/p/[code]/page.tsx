import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUnavailable, Unavailable } from '@/components/platform/unavailable';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { ProductView } from '@/components/public/product-view';
import { defaultJoinCode } from '@/lib/env';

// the shelf QR lands here. the staff app reads the same code as a stock look up.
export async function generateMetadata({ params }: PageProps<'/p/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const { locale } = await getT();
  const { api } = await serverApi(locale);
  const p = await api.shelfProduct(code).catch(() => null);
  return { title: { absolute: p ? `${p.name} · ${p.orgName}` : 'Custock' } };
}

export default async function ShelfProductPage({ params, searchParams }: PageProps<'/p/[code]'>) {
  const { code } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const result = await api.shelfProduct(code).catch((e: unknown) => (isUnavailable(e) ? 'unavailable' as const : null));
  if (result === 'unavailable') return <Unavailable />;
  const p = result;
  if (!p) notFound();

  // a poster QR can carry the shop's join code, so "notify me" and "join" land on the right shop
  const joinCode = typeof sp.j === 'string' ? sp.j : defaultJoinCode();
  const joinHref = joinCode ? `/j/${encodeURIComponent(joinCode)}` : null;
  const notifyHref = joinHref ? `${joinHref}?notify=${encodeURIComponent(p.name)}` : null;

  return (
    <PublicShell orgName={p.orgName} t={t}>
      <ProductView p={p} t={t} locale={locale} joinHref={joinHref} notifyHref={notifyHref} />
    </PublicShell>
  );
}
