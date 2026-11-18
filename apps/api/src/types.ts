import type { AccessAssignment, OrgAccess, Topology } from '@custock/core';
import type { AppLocale } from '@custock/i18n';
import type { Db } from '@custock/db';
import type { Tenant } from './lib/tenant';
import type { ExternalAuth } from './lib/external-auth';
import type { PhotoStore, StorageSetting } from './lib/storage';

export interface Config {
  db: Db;
  jwtSecret: string;
  dev: boolean;
  // where customer web pages live (join links, shelf product pages)
  publicWebUrl: string;
  corsOrigins: string[];
  now?: () => number;
  // turn off the per ip rate limits (tests move the clock and log in a lot). per email limits stay on.
  rateLimit?: boolean;
  // unsubscribe links are signed with their own key. derived from jwtSecret when not set.
  unsubSecret?: string;
  // behind our own reverse proxy: the rightmost X-Forwarded-For hop is the client
  trustedProxy?: boolean;
  // bot check secret for join pages. without it and outside dev, public signups are refused.
  turnstileSecret?: string;
  // the api's own public address, for upload links and files it serves itself
  apiPublicUrl?: string;
  // where dev uploads are stored
  uploadDir?: string;
  // who issues tokens: our dev login (default) or the real login server through its JWKS
  auth?: { mode: 'local' } | ExternalAuth;
  // which channels really send (live mode with their settings). missing means none, all in the outbox
  sending?: { email: boolean; fcm: boolean; webpush: boolean };
  // CUSTOCK_TURNSTILE=off: public signups without the bot check (rate limits still apply)
  turnstileOff?: boolean;
  // the VAPID public key browsers subscribe with. no key, no web push
  vapidPublicKey?: string;
  // shared with the web server in the same container: with it, X-Custock-Client-Ip is trusted
  internalKey?: string;
  // more hosts our shelf qr codes may point at, besides the host of publicWebUrl (CUSTOCK_OWN_DOMAINS)
  ownDomains?: string[];
  // where photos go: local (the default, dev and tests), s3 (R2 or AWS) or off
  storage?: StorageSetting;
  // tests hand in their own store, so nothing ever calls a real bucket
  photoStore?: PhotoStore;
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
    // true when the request said which language it wants (Accept-Language)
    localeFromHeader: boolean;
    // names in reports, set once per report request
    localeName: AppLocale;
    user: AuthUser;
    org: OrgContext;
  };
};
