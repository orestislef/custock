import type { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@/lib/i18n-server';
import { orgInfo, publicCatalog } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { FollowerCatalog } from '@/components/shopper/follower-catalog';
import { Empty } from '@/components/ui/kit';
import { IconTag } from '@/components/ui/icons';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('offers.title') };
}

export default async function OffersPage({ params }: PageProps<'/s/[org]/offers'>) {
  const { org } = await params;
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  const all = await publicCatalog(org, { locale });
  const items = (all ?? []).filter((p) => p.offer);
  // ending soonest first
  items.sort((a, b) => (a.offer?.validUntil ?? Infinity) - (b.offer?.validUntil ?? Infinity));

  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t}>
      <h1 className="t-large t-display m-0">{t('offers.title')}</h1>
      <p className="t-sub t-2 mt-2 mb-5">{t('offers.lead')}</p>
      {!all ? (
        <FollowerCatalog offersOnly />
      ) : items.length ? (
        <CatalogGrid items={items} t={t} locale={locale} hrefFor={(p) => `/s/${org}/p/${p.id}`} />
      ) : (
        <Empty icon={<IconTag size={40} />} title={t('offers.emptyTitle')} body={t('offers.emptyBody')}
          action={info.joinCode ? <Link href={`/j/${info.joinCode}`} className="btn btn-primary">{t('offers.join', { org: info.name })}</Link> : undefined} />
      )}
    </PublicShell>
  );
}
