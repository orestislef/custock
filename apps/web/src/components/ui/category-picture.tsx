// a category's picture: its own photo, or one of the built in icons on a soft accent tile. the
// icon shapes come from @custock/core (category-icons.ts), drawn on the app's icon grid.

import { categoryIcon } from '@custock/core';

export function CategoryIcon({ iconKey, size = 22, className }: { iconKey: string | null | undefined; size?: number; className?: string }) {
  const shape = categoryIcon(iconKey);
  if (!shape) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={className}>
      {shape.paths.map((d) => <path key={d} d={d} />)}
      {shape.circles?.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
    </svg>
  );
}

// null when the category has no picture, so callers decide what an empty spot looks like
export function CategoryPicture({ iconKey, imageUrl, size = 40, rounded, className }: {
  iconKey?: string | null; imageUrl?: string | null; size?: number; rounded?: number; className?: string;
}) {
  const radius = rounded ?? Math.round(size * 0.24);
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" width={size} height={size} loading="lazy" decoding="async"
        className={`object-cover flex-none ${className ?? ''}`} style={{ width: size, height: size, borderRadius: radius }} />
    );
  }
  if (!categoryIcon(iconKey)) return null;
  return (
    <span aria-hidden="true" className={`inline-grid place-items-center flex-none ${className ?? ''}`}
      style={{ width: size, height: size, borderRadius: radius, background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}>
      <CategoryIcon iconKey={iconKey} size={Math.round(size * 0.56)} />
    </span>
  );
}

// a large empty photo spot (a product card or page without a photo) showing the category's icon.
// null when the category has no icon, so the usual letter shows instead
export function CategoryPlaceholder({ iconKey, className }: { iconKey: string | null | undefined; className?: string }) {
  if (!categoryIcon(iconKey)) return null;
  return (
    <span aria-hidden="true" className={`grid place-items-center ${className ?? ''}`} style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}>
      <CategoryIcon iconKey={iconKey} size={56} />
    </span>
  );
}
