// which customers a member can see, and how they look to them (thinking/02 and 03)

import type { Context } from 'hono';
import { followsShop, maskEmail, maskPhone, type Customer, type Subscription } from '@custock/core';
import type { AppEnv } from '../types';
import { orgOf, orgWide, shopsFor } from '../lib/context';
import { avatarKeySql, fileUrl } from './catalog';

export interface CustomerRow {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  locale: 'en' | 'el' | 'ru';
  email_ok: number;
  push_ok: number;
  sms_ok: number;
  source: 'join_link' | 'app' | 'staff' | 'import';
  search_key: string | null;
  contact_key?: string | null;
  created_at: number;
  // the storage key of the person's profile photo, when they have an account and a photo
  avatar_key?: string | null;
}

export const CUSTOMER_COLUMNS = `id, user_id, name, email, phone, locale, email_ok, push_ok, sms_ok, source, search_key, contact_key, created_at,
  ${avatarKeySql('customers.user_id')} AS avatar_key`;

export function loadSubscriptions(c: Context<AppEnv>, customerIds?: string[]): Map<string, Subscription[]> {
  const { t } = orgOf(c);
  const rows = customerIds
    ? t.all<{ customer_id: string; scope_type: Subscription['scopeType']; scope_id: string; status: Subscription['status'] }>(
        'SELECT customer_id, scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@ids))',
        { ids: customerIds },
      )
    : t.all<{ customer_id: string; scope_type: Subscription['scopeType']; scope_id: string; status: Subscription['status'] }>(
        'SELECT customer_id, scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org',
      );
  const m = new Map<string, Subscription[]>();
  for (const r of rows) m.set(r.customer_id, [...(m.get(r.customer_id) ?? []), { scopeType: r.scope_type, scopeId: r.scope_id, status: r.status }]);
  return m;
}

export interface Visibility {
  all: boolean; // org scoped, sees every customer
  shops: string[]; // shops through which customers are visible
  contactAll: boolean;
  contactShops: string[];
}

export function customerVisibility(c: Context<AppEnv>): Visibility {
  return {
    all: orgWide(c, 'customers.view'),
    shops: shopsFor(c, 'customers.view'),
    contactAll: orgWide(c, 'customers.contact.view'),
    contactShops: shopsFor(c, 'customers.contact.view'),
  };
}

// shops a customer reaches, counting pending signups so staff see new people
export function reachedShops(c: Context<AppEnv>, subs: Subscription[]): string[] {
  const { topology } = orgOf(c);
  return topology.shops.filter((s) => followsShop(subs, topology, s, true));
}

export function canSeeContact(v: Visibility, reached: string[]): boolean {
  return v.contactAll || reached.some((s) => v.contactShops.includes(s));
}

export function canSee(v: Visibility, reached: string[]): boolean {
  return v.all || reached.some((s) => v.shops.includes(s));
}

export function toCustomer(row: CustomerRow, subs: Subscription[], tags: string[], v: Visibility, reached: string[]): Customer {
  const full = v.contactAll || reached.some((s) => v.contactShops.includes(s));
  return {
    id: row.id,
    name: row.name,
    email: full ? row.email : maskEmail(row.email),
    phone: full ? row.phone : maskPhone(row.phone),
    contactMasked: !full,
    locale: row.locale,
    emailOk: !!row.email_ok,
    pushOk: !!row.push_ok,
    smsOk: !!row.sms_ok,
    hasApp: !!row.user_id,
    source: row.source,
    tags,
    subscriptions: subs,
    createdAt: row.created_at,
    avatarUrl: fileUrl(row.avatar_key),
  };
}

export function loadTags(c: Context<AppEnv>, customerIds: string[]): Map<string, string[]> {
  const { t } = orgOf(c);
  const rows = t.all<{ customer_id: string; tag: string }>(
    'SELECT customer_id, tag FROM customer_tags WHERE org_id = @org AND customer_id IN (SELECT value FROM json_each(@ids)) ORDER BY tag',
    { ids: customerIds },
  );
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.customer_id, [...(m.get(r.customer_id) ?? []), r.tag]);
  return m;
}
