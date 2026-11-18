'use client';

// a business that shows its catalog to followers only: signed in followers see it here, everyone
// else gets the way in (join, or sign in when they already did)

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicProduct } from '@custock/core';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { CategoryTiles, type TileCategory } from '@/components/public/category-tiles';
import { Empty } from '@/components/ui/kit';
import { IconBox } from '@/components/ui/icons';
import { useLocale, useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

export function FollowerCatalog({ offersOnly, categories = [], categoryId = '' }: { offersOnly?: boolean; categories?: TileCategory[]; categoryId?: string }) {
  const t = useT();
  const locale = useLocale();
  const { api, slug, orgName, joinCode, status, follow } = useShopper();
  const [items, setItems] = useState<PublicProduct[] | null>(null);
  const active = categories.some((c) => c.id === categoryId) ? categoryId : '';

  useEffect(() => {
    if (!follow) return;
    void api.catalog(slug, active ? { categoryId: active } : undefined).then(setItems, () => setItems([]));
  }, [api, slug, follow, active]);

  if (status === 'loading' || (follow && !items)) return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (follow && items) {
    const list = offersOnly ? items.filter((p) => p.offer) : items;
    return (
      <>
        {offersOnly ? null : <CategoryTiles className="mb-4" categories={categories} active={active} t={t} hrefFor={(id) => (id ? `/s/${slug}?category=${encodeURIComponent(id)}` : `/s/${slug}`)} />}
        {list.length
          ? <CatalogGrid items={list} t={t} locale={locale} hrefFor={(p) => `/s/${slug}/p/${p.id}`} />
          : <Empty icon={<IconBox size={40} />} title={offersOnly ? t('offers.emptyTitle') : t('catalog.noResults')} body={offersOnly ? t('offers.emptyBody') : undefined} />}
      </>
    );
  }
  return (
    <Empty icon={<IconBox size={40} />} title={t('catalog.followersTitle', { org: orgName })} body={joinCode ? t('catalog.followersBody') : t('catalog.followersBodyNoLink', { org: orgName })}
      action={
        <div className="flex flex-col gap-2 items-center">
          {joinCode ? <Link href={`/j/${joinCode}`} className="btn btn-primary">{t('catalog.joinToBrowse', { org: orgName })}</Link> : null}
          {status === 'signedOut' ? <Link href={`/s/${slug}/me`} className="btn btn-plain">{t('shopper.signIn.already')}</Link> : null}
        </div>
      } />
  );
}
