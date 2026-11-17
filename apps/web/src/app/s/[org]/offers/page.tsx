import type { Metadata } from 'next';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { Empty } from '@/components/ui/kit';
import { IconTag } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Offers' };

export default async function OffersPage({ params }: PageProps<'/s/[org]/offers'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const items = (await api.catalog(org).catch(() => [])).filter((p) => p.offer);
  // ending soonest first
  items.sort((a, b) => (a.offer?.validUntil ?? Infinity) - (b.offer?.validUntil ?? Infinity));
  const orgName = items[0]?.orgName ?? org;

  return (
    <PublicShell orgName={orgName} t={t} back={{ href: `/s/${org}`, label: t('catalog.title') }}>
      <h1 className="t-large t-display m-0">{t('offers.title')}</h1>
      <p className="t-sub t-2 mt-2 mb-5">{t('offers.lead')}</p>
      {items.length ? (
        <CatalogGrid items={items} t={t} locale={locale} hrefFor={(p) => `/s/${org}/p/${p.id}`} />
      ) : (
        <Empty icon={<IconTag size={40} />} title={t('offers.emptyTitle')} body={t('offers.emptyBody')} />
      )}
    </PublicShell>
  );
}
