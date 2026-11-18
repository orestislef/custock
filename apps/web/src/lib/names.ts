import type { Post, Product, Role } from '@custock/core';
import type { TFunction } from '@custock/i18n/client';

// user content: the viewer's language when the business wrote one, the default otherwise
export function productName(p: Pick<Product, 'name' | 'translations'> & { displayName?: string }, locale: string): string {
  // the api localizes displayName by Accept-Language. name stays the default for editing
  return p.translations?.[locale]?.name ?? p.displayName ?? p.name;
}

export function postText(p: Pick<Post, 'translations' | 'defaultLocale'>, locale: string) {
  return p.translations[locale] ?? p.translations[p.defaultLocale] ?? Object.values(p.translations)[0] ?? { title: '', body: '' };
}

export function variantLabel(options: Record<string, string> | null | undefined): string {
  if (!options) return '';
  return Object.values(options).join(' · ');
}

// default roles are translated, custom roles show the name the business gave them
export function roleLabel(t: TFunction, r: Pick<Role, 'templateKey' | 'name'>): string {
  return r.templateKey ? t(`common:role.${r.templateKey}`, { defaultValue: r.name }) : r.name;
}

// a role known only by its name (team assignments, invites): the default roles are translated,
// a role the business made itself keeps its own name
const DEFAULT_ROLES = new Set(['owner', 'admin', 'manager', 'staff', 'viewer']);
export function roleNameLabel(t: TFunction, name: string): string {
  const key = name.trim().toLowerCase();
  return DEFAULT_ROLES.has(key) ? t(`common:role.${key}`, { defaultValue: name }) : name;
}
