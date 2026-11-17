import type { Post, Product } from '@custock/core';

// user content: the viewer's language when the business wrote one, the default otherwise
export function productName(p: Pick<Product, 'name' | 'translations'>, locale: string): string {
  return p.translations?.[locale]?.name ?? p.name;
}

export function postText(p: Pick<Post, 'translations' | 'defaultLocale'>, locale: string) {
  return p.translations[locale] ?? p.translations[p.defaultLocale] ?? Object.values(p.translations)[0] ?? { title: '', body: '' };
}

export function variantLabel(options: Record<string, string> | null | undefined): string {
  if (!options) return '';
  return Object.values(options).join(' · ');
}
