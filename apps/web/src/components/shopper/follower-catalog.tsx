'use client';

// a business that shows its catalog to followers only: signed in followers see it here, everyone
// else gets the way in (join, or sign in when they already did)

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicProduct } from '@custock/core';
import { CatalogGrid } from '@/components/public/catalog-grid';
import { Empty } from '@/components/ui/kit';
import { IconBox } from '@/components/ui/icons';
import { useLocale, useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

export function FollowerCatalog({ offersOnly }: { offersOnly?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { api, slug, orgName, joinCode, status, follow } = useShopper();
  const [items, setItems] = useState<PublicProduct[] | null>(null);

  useEffect(() => {
    if (!follow) return;
    void api.catalog(slug).then(setItems, () => setItems([]));
  }, [api, slug, follow]);

  if (status === 'loading' || (follow && !items)) return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (follow && items) {
    const list = offersOnly ? items.filter((p) => p.offer) : items;
    return list.length
      ? <CatalogGrid items={list} t={t} locale={locale} hrefFor={(p) => `/s/${slug}/p/${p.id}`} />
      : <Empty icon={<IconBox size={40} />} title={offersOnly ? t('offers.emptyTitle') : t('catalog.noResults')} body={offersOnly ? t('offers.emptyBody') : undefined} />;
  }
  return (
    <Empty icon={<IconBox size={40} />} title={t('catalog.followersTitle', { org: orgName })} body={t('catalog.followersBody')}
      action={
        <div className="flex flex-col gap-2 items-center">
          {joinCode ? <Link href={`/j/${joinCode}`} className="btn btn-primary">{t('catalog.joinToBrowse', { org: orgName })}</Link> : null}
          {status === 'signedOut' ? <Link href={`/s/${slug}/me`} className="btn btn-plain">{t('shopper.signIn.already')}</Link> : null}
        </div>
      } />
  );
}
