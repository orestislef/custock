import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { Empty } from '@/components/ui/kit';
import { IconBox, IconSearch } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Catalog' };

export default async function CatalogPage({ params, searchParams }: PageProps<'/s/[org]'>) {
  const { org } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const items = await api.catalog(org, q ? { q } : undefined).catch(() => null);
  const orgName = items?.[0]?.orgName ?? org.charAt(0).toUpperCase() + org.slice(1);

  if (!items) {
    return (
      <PublicShell orgName={orgName} t={t}>
        <Empty icon={<IconBox size={40} />} title={t('catalog.closedTitle')} body={t('catalog.closedBody', { org: orgName })} />
      </PublicShell>
    );
  }

  const offers = items.filter((p) => p.offer).length;

  return (
    <PublicShell orgName={orgName} t={t}>
      <h1 className="t-large t-display m-0">{t('catalog.title')}</h1>
      <form className="search mt-4 mb-3" role="search" action={`/s/${org}`}>
        <IconSearch size={18} />
        <input name="q" defaultValue={q} placeholder={t('catalog.search')} aria-label={t('catalog.search')} />
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
        <Empty icon={<IconSearch size={40} />} title={t('catalog.noResults')} body={t('catalog.noResultsBody', { q })} />
      )}
    </PublicShell>
  );
}
