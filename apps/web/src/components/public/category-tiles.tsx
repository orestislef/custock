// the categories of a business above its catalog: a sideways row of tiles with the category's photo
// or icon and its name in the visitor's language. tapping one filters the catalog, "All" clears it.

import Link from 'next/link';
import type { TFunction } from '@custock/i18n';
import { CategoryPicture } from '@/components/ui/category-picture';
import { IconBox, IconTag } from '@/components/ui/icons';

export interface TileCategory { id: string; name: string; iconKey?: string | null; imageUrl?: string | null }

export function CategoryTiles({ categories, active, hrefFor, t, className }: {
  categories: TileCategory[];
  active: string;
  hrefFor: (categoryId: string) => string;
  t: TFunction;
  className?: string;
}) {
  if (categories.length < 2) return null;
  return (
    <nav aria-label={t('catalog.categories')} className={className}>
      <div className="cat-tiles">
        <Link href={hrefFor('')} className="cat-tile" aria-current={!active ? 'page' : undefined} scroll={false}>
          <span className="cat-tile-pic"><IconBox size={26} /></span>
          <span className="cat-tile-name">{t('catalog.allCategories')}</span>
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={hrefFor(c.id)} className="cat-tile" aria-current={active === c.id ? 'page' : undefined} scroll={false}>
            <span className="cat-tile-pic">
              {c.imageUrl || c.iconKey ? <CategoryPicture iconKey={c.iconKey} imageUrl={c.imageUrl} size={60} rounded={16} /> : <IconTag size={24} />}
            </span>
            <span className="cat-tile-name">{c.name}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
