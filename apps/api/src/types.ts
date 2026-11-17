import type { AccessAssignment, OrgAccess, Topology } from '@custock/core';
import type { AppLocale } from '@custock/i18n';
import type { Db } from '@custock/db';
import type { Tenant } from './lib/tenant';

export interface Config {
  db: Db;
  jwtSecret: string;
  dev: boolean;
  // where customer web pages live (join links, shelf product pages)
  publicWebUrl: string;
  corsOrigins: string[];
  now?: () => number;
}

export interface AuthUser {
  id: string;
  sessionId: string;
  email: string | null;
  displayName: string | null;
  locale: AppLocale;
}

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  default_locale: AppLocale;
  logo_file_id: string | null;
  brand_color: string | null;
  allow_negative_stock: number;
  posts_need_approval: number;
  push_daily_cap: number;
  quiet_hours: string;
  customer_catalog: 'off' | 'subscribers' | 'public';
  customer_prices: number;
  customer_stock: 'off' | 'availability' | 'exact';
  few_left_threshold: number;
}

export interface OrgContext {
  org: OrgRow;
  t: Tenant;
  membershipId: string;
  permsVersion: number;
  access: OrgAccess;
  topology: Topology;
  assignments: AccessAssignment[];
  shopNames: Record<string, string>;
  groupNames: Record<string, string>;
}

export type AppEnv = {
  Variables: {
    cfg: Config;
    requestId: string;
    locale: AppLocale;
    user: AuthUser;
    org: OrgContext;
  };
};
