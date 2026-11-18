import Link from 'next/link';
import type { PublicProduct } from '@custock/core';
import type { TFunction } from '@custock/i18n/client';
import { Photo } from '@/components/ui/client-kit';
import { CategoryPlaceholder } from '@/components/ui/category-picture';
import { PriceLine } from './product-view';

export function CatalogGrid({ items, t, locale, hrefFor }: { items: PublicProduct[]; t: TFunction; locale: string; hrefFor: (p: PublicProduct) => string }) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 list-none p-0 m-0">
      {items.map((p) => {
        const known = p.availability.filter((a) => a.state != null);
        const inShops = known.filter((a) => a.state !== 'out').length;
        return (
          <li key={p.id}>
            <Link href={hrefFor(p)} className="card block h-full hover:no-underline" style={{ color: 'var(--c-ink)' }}>
              <div style={{ aspectRatio: '1 / 1' }}>
                <Photo src={p.images[0]?.url} alt={p.name} className="w-full h-full" rounded={0} fallback={p.categoryIconKey ? <CategoryPlaceholder iconKey={p.categoryIconKey} className="w-full h-full" /> : undefined} />
              </div>
              <div className="p-3">
                <p className="t-sub m-0 line-clamp-2" style={{ minHeight: 40 }}>{p.name}</p>
                <PriceLine p={p} t={t} locale={locale} small />
                {known.length ? (
                  <p className="t-foot m-0 mt-1" style={{ color: inShops ? 'var(--c-ink-2)' : 'var(--c-out-text)' }}>
                    {inShops ? t('catalog.inShops', { count: inShops }) : t('common:stock.out')}
                  </p>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
