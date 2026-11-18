// the words for audit log rows, shared by the business audit and the platform audit. every action
// the api writes has a sentence (see packages/core audit-actions.ts and its test); anything else
// gets a readable sentence built from what it is about, never the raw key.

import type { TFunction } from '@custock/i18n';

type T = TFunction;

const REMOVED = /(deleted|archived|erased|removed|revoked|cancelled|unassigned|detached)/;
const ADDED = /(created|added|sent|invited|published|scheduled|submitted|assigned|accepted)/;

// a translation, or null when the key has none
function found(t: T, key: string): string | null {
  const v: unknown = t(key);
  return typeof v === 'string' && v && v !== key && !v.endsWith(key) ? v : null;
}

// "changed a category", "added a product": from the part before the first dot
export function auditFallbackVerb(t: T, action: string): string {
  const dot = action.indexOf('.');
  const prefix = dot > 0 ? action.slice(0, dot) : action;
  const rest = dot > 0 ? action.slice(dot + 1) : '';
  const thing = found(t, `audit.thing.${prefix}`) ?? t('audit.thing.other');
  const kind = REMOVED.test(rest) ? 'removed' : ADDED.test(rest) ? 'added' : 'changed';
  return t(`audit.fallback.${kind}`, { thing });
}

// the verb phrase inside "{{actor}} {{verb}}", lower case
export function auditVerb(t: T, action: string): string {
  return found(t, `audit.action.${action}`) ?? auditFallbackVerb(t, action);
}

export function capitalize(text: string, locale: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}

// a row title in the platform audit: its own words for platform actions, the business sentence
// for everything a super admin did inside a business
export function platformAuditLabel(t: T, action: string, locale: string): string {
  return found(t, `platform.audit.action.${action}`) ?? capitalize(auditVerb(t, action), locale);
}

// a name from a details object: plain strings, or names kept per language
export function nameIn(value: unknown, locale: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const own = o[locale];
    if (typeof own === 'string' && own) return own;
    const first = Object.values(o).find((v) => typeof v === 'string' && v);
    if (typeof first === 'string') return first;
  }
  return '';
}

// the most telling detail of a change: a name, a label or an address
export function auditDetail(before: unknown, after: unknown, locale: string): string {
  for (const side of [after, before]) {
    if (!side || typeof side !== 'object') continue;
    const o = side as Record<string, unknown>;
    for (const k of ['name', 'label', 'email', 'owner', 'slug', 'code']) {
      const v = nameIn(o[k], locale);
      if (v) return v;
    }
  }
  return '';
}
