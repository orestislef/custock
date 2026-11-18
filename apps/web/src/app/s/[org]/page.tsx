import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n-server';
import { publicCatalog } from '@/lib/storefront';
import { PublicShell } from '@/components/public/public-shell';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { FollowerCatalog } from '@/components/shopper/follower-catalog';
import { OrgCoach } from '@/components/shopper/org-coach';
import { CustomerPushCard } from '@/components/shopper/push-card';
import { Empty } from '@/components/ui/kit';
import { IconSearch } from '@/components/ui/icons';
import { orgInfo } from '@/lib/storefront';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('catalog.title') };
}

export default async function CatalogPage({ params, searchParams }: PageProps<'/s/[org]'>) {
  const { org } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  // a tapped notification about a post lands on the news, at that post
  if (typeof sp.post === 'string' && sp.post) redirect(`/s/${org}/news?post=${encodeURIComponent(sp.post)}`);
  const { t, locale } = await getT();
  const info = await orgInfo(org, locale);
  const items = await publicCatalog(org, { q, locale });
  const offers = items?.filter((p) => p.offer).length ?? 0;

  return (
    <PublicShell orgName={info.name} logoUrl={info.logoUrl} t={t}>
      <h1 className="t-large t-display m-0">{t('catalog.title')}</h1>
      <OrgCoach className="mt-4" />
      <CustomerPushCard className="mt-4" installCoachShown />
      {items ? (
        <>
          <form className="search mt-4 mb-3" role="search" action="">
            <IconSearch size={18} />
            <input name="q" type="search" inputMode="search" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={200} defaultValue={q} placeholder={t('catalog.search')} aria-label={t('catalog.search')} enterKeyHint="search" />
          </form>
          {offers ? (
            <Link href={`/s/${org}/offers`} className="row card mb-5" style={{ color: 'var(--c-ink)' }}>
              <span className="badge badge-accent">{t('common:postKind.offer')}</span>
              <span className="row-main t-sub">{t('catalog.offersLink', { count: offers })}</span>
            </Link>
          ) : null}
          {items.length ? (
            <CatalogGrid items={items} t={t} locale={locale} hrefFor={(p) => `/s/${org}/p/${p.id}`} />
          ) : (
            <Empty icon={<IconSearch size={40} />} title={t('catalog.noResults')} body={q ? t('catalog.noResultsBody', { q }) : undefined} />
          )}
        </>
      ) : (
        <div className="mt-6"><FollowerCatalog /></div>
      )}
    </PublicShell>
  );
}
