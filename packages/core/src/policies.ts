// the policy engine: every limit and option in one registry. a value can be set at several levels,
// from the widest to the narrowest:
//
//   platform   the super admin's default for everyone (env vars stay the outermost default)
//   limit      the super admin's ceiling for one business (a cap, never a value of its own)
//   business   the owner's choice for the whole business
//   shop       one shop of the business
//   role       one role of the business
//   user       one person in the business
//
// the narrowest value that is set wins, always held inside the levels above it (see `cap`). a
// super admin also decides per business whether its people may change a key at all (delegation).
// defaults are exactly what the app did before the engine existed.
// the zod shapes of the api live in policy-schemas.ts, so screens that only read the registry stay
// small in the browser.

export type PolicyLevel = 'platform' | 'limit' | 'business' | 'shop' | 'role' | 'user';
export type PolicyValue = number | boolean | string;
export type PolicyType = 'int' | 'bool' | 'enum' | 'window';
export type PolicyGroup = 'messages' | 'posts' | 'stock' | 'customers' | 'alerts' | 'security' | 'lifetimes' | 'uploads' | 'retention';

// how a narrower value is held by a wider one
//   max      never above the wider value (0 means "no limit" when noneIsZero)
//   min      never below the wider value
//   require  true above means true below (true is the stricter side)
//   allow    false above means false below (false is the stricter side)
//   window   a time window that must contain the wider one (quiet hours can only grow)
//   free     no relation, the narrowest wins (personal preferences)
export type PolicyCap = 'max' | 'min' | 'require' | 'allow' | 'window' | 'free';

export interface PolicyDef {
  key: string;
  group: PolicyGroup;
  type: PolicyType;
  default: PolicyValue;
  // levels where a value may be set. 'platform' is always one of them
  levels: readonly PolicyLevel[];
  cap: PolicyCap;
  min?: number;
  max?: number;
  options?: readonly string[];
  // for int: 0 is "no limit"
  noneIsZero?: boolean;
  unit?: 'count' | 'minutes' | 'days' | 'megabytes';
  // permission needed for business values (and shop values unless shopPermission is set)
  permission?: string;
  shopPermission?: string;
  // a person may set their own value (only preferences that give no extra power)
  selfService?: boolean;
  // business values live in this organizations column (kept as the source of truth)
  column?: string;
  // owners may change it unless the super admin switches it off for their business
  delegatedByDefault?: boolean;
  // env var that replaces the default, the outermost default
  env?: string;
}

const W = '22:00-09:00';

export const POLICIES: readonly PolicyDef[] = [
  // messages to customers
  { key: 'push.dailyCap', group: 'messages', type: 'int', default: 2, min: 0, max: 5, unit: 'count', levels: ['platform', 'limit', 'business'], cap: 'max', permission: 'settings.push', column: 'push_daily_cap', delegatedByDefault: true },
  { key: 'push.quietHours', group: 'messages', type: 'window', default: W, levels: ['platform', 'limit', 'business'], cap: 'window', permission: 'settings.push', column: 'quiet_hours', delegatedByDefault: true },

  // posts
  { key: 'posts.needApproval', group: 'posts', type: 'bool', default: false, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'require', permission: 'org.settings.manage', column: 'posts_need_approval', delegatedByDefault: true },
  { key: 'posts.dailyLimit', group: 'posts', type: 'int', default: 0, min: 0, max: 50, unit: 'count', noneIsZero: true, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'max', permission: 'org.settings.manage', delegatedByDefault: true },

  // stock
  { key: 'stock.allowNegative', group: 'stock', type: 'bool', default: true, levels: ['platform', 'limit', 'business'], cap: 'allow', permission: 'org.settings.manage', column: 'allow_negative_stock', delegatedByDefault: true },
  { key: 'stock.fewLeft', group: 'stock', type: 'int', default: 3, min: 0, max: 100, unit: 'count', levels: ['platform', 'limit', 'business'], cap: 'free', permission: 'org.settings.manage', column: 'few_left_threshold', delegatedByDefault: true },
  { key: 'stock.adjustLimit', group: 'stock', type: 'int', default: 0, min: 0, max: 100000, unit: 'count', noneIsZero: true, levels: ['platform', 'limit', 'business', 'shop', 'role', 'user'], cap: 'max', permission: 'org.settings.manage', shopPermission: 'stock.settings.manage', delegatedByDefault: true },

  // what customers see
  { key: 'catalog.mode', group: 'customers', type: 'enum', default: 'subscribers', options: ['off', 'subscribers', 'public'], levels: ['platform', 'limit', 'business'], cap: 'free', permission: 'org.settings.manage', column: 'customer_catalog', delegatedByDefault: true },
  { key: 'catalog.prices', group: 'customers', type: 'bool', default: true, levels: ['platform', 'limit', 'business'], cap: 'free', permission: 'org.settings.manage', column: 'customer_prices', delegatedByDefault: true },
  { key: 'catalog.offerPrices', group: 'customers', type: 'bool', default: true, levels: ['platform', 'limit', 'business'], cap: 'free', permission: 'org.settings.manage', column: 'customer_offer_prices', delegatedByDefault: true },
  { key: 'catalog.stock', group: 'customers', type: 'enum', default: 'off', options: ['off', 'availability', 'exact'], levels: ['platform', 'limit', 'business'], cap: 'free', permission: 'org.settings.manage', column: 'customer_stock', delegatedByDefault: true },

  // staff alerts, a person's own choice. the business and roles set the starting point
  { key: 'alerts.lowStock', group: 'alerts', type: 'bool', default: true, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'free', selfService: true, permission: 'org.settings.manage', delegatedByDefault: true },
  { key: 'alerts.transfers', group: 'alerts', type: 'bool', default: true, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'free', selfService: true, permission: 'org.settings.manage', delegatedByDefault: true },
  { key: 'alerts.approvals', group: 'alerts', type: 'bool', default: true, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'free', selfService: true, permission: 'org.settings.manage', delegatedByDefault: true },
  { key: 'alerts.counts', group: 'alerts', type: 'bool', default: true, levels: ['platform', 'limit', 'business', 'role', 'user'], cap: 'free', selfService: true, permission: 'org.settings.manage', delegatedByDefault: true },

  // sign in and safety. the minimums keep them from ever being switched off
  { key: 'auth.accessMinutes', group: 'security', type: 'int', default: 15, min: 5, max: 60, unit: 'minutes', levels: ['platform'], cap: 'max' },
  { key: 'auth.sessionDays', group: 'security', type: 'int', default: 30, min: 1, max: 90, unit: 'days', levels: ['platform', 'limit', 'business', 'role'], cap: 'max', permission: 'org.settings.manage', delegatedByDefault: true },
  { key: 'auth.loginAttempts', group: 'security', type: 'int', default: 5, min: 3, max: 10, unit: 'count', levels: ['platform'], cap: 'max' },
  { key: 'auth.lockMinutes', group: 'security', type: 'int', default: 15, min: 5, max: 120, unit: 'minutes', levels: ['platform'], cap: 'min' },
  { key: 'auth.otpMinutes', group: 'security', type: 'int', default: 10, min: 5, max: 30, unit: 'minutes', levels: ['platform'], cap: 'max' },
  { key: 'auth.resetMinutes', group: 'security', type: 'int', default: 30, min: 10, max: 120, unit: 'minutes', levels: ['platform'], cap: 'max' },
  { key: 'rate.publicPerMinute', group: 'security', type: 'int', default: 120, min: 30, max: 600, unit: 'count', levels: ['platform'], cap: 'max' },
  { key: 'rate.authPerMinute', group: 'security', type: 'int', default: 20, min: 5, max: 100, unit: 'count', levels: ['platform'], cap: 'max' },

  // how long links and codes work
  { key: 'invites.staffDays', group: 'lifetimes', type: 'int', default: 7, min: 1, max: 30, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'invites.ownerDays', group: 'lifetimes', type: 'int', default: 14, min: 1, max: 30, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'invites.superAdminDays', group: 'lifetimes', type: 'int', default: 7, min: 1, max: 14, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'join.confirmDays', group: 'lifetimes', type: 'int', default: 7, min: 1, max: 30, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'email.changeCodeMinutes', group: 'lifetimes', type: 'int', default: 15, min: 5, max: 60, unit: 'minutes', levels: ['platform'], cap: 'max' },

  // uploads
  { key: 'uploads.maxMegabytes', group: 'uploads', type: 'int', default: 5, min: 1, max: 10, unit: 'megabytes', levels: ['platform'], cap: 'max' },

  // how long the server keeps things
  { key: 'retention.outboxDays', group: 'retention', type: 'int', default: 30, min: 7, max: 365, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'retention.errorDays', group: 'retention', type: 'int', default: 30, min: 7, max: 90, unit: 'days', levels: ['platform'], cap: 'max' },
  { key: 'retention.unconfirmedDays', group: 'retention', type: 'int', default: 30, min: 7, max: 90, unit: 'days', levels: ['platform'], cap: 'max' },
];

export const POLICY_KEYS: readonly string[] = POLICIES.map((p) => p.key);
export const POLICY_GROUPS: readonly PolicyGroup[] = ['messages', 'posts', 'stock', 'customers', 'alerts', 'security', 'lifetimes', 'uploads', 'retention'];

const byKey = new Map(POLICIES.map((p) => [p.key, p]));
export function policyDef(key: string): PolicyDef | undefined {
  return byKey.get(key);
}
export function hasLevel(def: PolicyDef, level: PolicyLevel): boolean {
  return def.levels.includes(level);
}
// keys an owner can ever touch (business level and below)
export function isBusinessKey(def: PolicyDef): boolean {
  return hasLevel(def, 'business');
}

// ------------------------------------------------------------------ time windows

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export function isWindow(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const [a, b] = v.split('-');
  return !!a && !!b && HM.test(a) && HM.test(b);
}
function minutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h! * 60 + m!;
}
// every minute of the day inside the window. "22:00-09:00" crosses midnight, equal ends is empty
function windowMinutes(w: string): Set<number> {
  const [a, b] = w.split('-').map(minutes) as [number, number];
  const out = new Set<number>();
  if (a === b) return out;
  for (let m = a; m !== b; m = (m + 1) % 1440) out.add(m);
  return out;
}
export function windowContains(outer: string, inner: string): boolean {
  const o = windowMinutes(outer);
  for (const m of windowMinutes(inner)) if (!o.has(m)) return false;
  return true;
}
export function normalizeWindow(w: string): string {
  const pad = (hm: string) => {
    const [h, m] = hm.split(':');
    return `${h!.padStart(2, '0')}:${m}`;
  };
  const [a, b] = w.split('-');
  return `${pad(a!)}-${pad(b!)}`;
}

// ------------------------------------------------------------------ values

// a stored or sent value, made the right type and held inside the hard bounds. null if it is not
// a value of this key at all
export function coerce(def: PolicyDef, v: unknown): PolicyValue | null {
  switch (def.type) {
    case 'int': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return null;
      const i = Math.round(n);
      return Math.min(def.max ?? Number.MAX_SAFE_INTEGER, Math.max(def.min ?? Number.MIN_SAFE_INTEGER, i));
    }
    case 'bool':
      if (typeof v === 'boolean') return v;
      if (v === 1 || v === 0) return v === 1;
      if (v === 'true' || v === 'false') return v === 'true';
      return null;
    case 'enum':
      return typeof v === 'string' && def.options?.includes(v) ? v : null;
    case 'window':
      return isWindow(v) ? normalizeWindow(v) : null;
  }
}

// is `v` inside the hard bounds (writes refuse rather than clamp)
export function inBounds(def: PolicyDef, v: PolicyValue): boolean {
  if (def.type === 'int') return typeof v === 'number' && Number.isInteger(v) && v >= (def.min ?? -Infinity) && v <= (def.max ?? Infinity);
  if (def.type === 'bool') return typeof v === 'boolean';
  if (def.type === 'enum') return typeof v === 'string' && !!def.options?.includes(v);
  return isWindow(v);
}

const isNone = (def: PolicyDef, v: PolicyValue) => def.noneIsZero === true && v === 0;

// `v` held inside `upper`, the value of the level above
export function cap(def: PolicyDef, v: PolicyValue, upper: PolicyValue): PolicyValue {
  switch (def.cap) {
    case 'max':
      if (isNone(def, upper as number)) return v;
      if (isNone(def, v as number)) return upper;
      return Math.min(v as number, upper as number);
    case 'min':
      return Math.max(v as number, upper as number);
    case 'require':
      return upper === true ? true : v;
    case 'allow':
      return upper === false ? false : v;
    case 'window':
      return windowContains(v as string, upper as string) ? v : upper;
    case 'free':
      return v;
  }
}

// does `v` stay inside `upper`? (writes refuse values that would be capped)
export function within(def: PolicyDef, v: PolicyValue, upper: PolicyValue): boolean {
  if (def.cap === 'max' && isNone(def, v as number)) return isNone(def, upper as number);
  return cap(def, v, upper) === v;
}

// the wider value from two roles of the same person: the more permissive wins, like permissions do
export function looser(def: PolicyDef, a: PolicyValue, b: PolicyValue): PolicyValue {
  switch (def.cap) {
    case 'max':
      if (isNone(def, a as number) || isNone(def, b as number)) return 0;
      return Math.max(a as number, b as number);
    case 'min':
      return Math.min(a as number, b as number);
    case 'require':
      return a === true && b === true;
    case 'allow':
      return a === true || b === true;
    default:
      return a;
  }
}

export interface PolicyLayers {
  platform?: PolicyValue | null;
  limit?: PolicyValue | null;
  business?: PolicyValue | null;
  shop?: PolicyValue | null;
  roles?: readonly PolicyValue[];
  user?: PolicyValue | null;
}

// the value in force, from the widest level to the narrowest. `stopAt` gives the value a level
// inherits (for example what a role starts from) instead of the final one
export function resolvePolicy(def: PolicyDef, layers: PolicyLayers, stopAt?: 'business' | 'shop' | 'role' | 'user'): PolicyValue {
  const ok = (v: PolicyValue | null | undefined): v is PolicyValue => v !== null && v !== undefined && inBounds(def, v);
  const platformValue = ok(layers.platform) ? layers.platform : def.default;
  if (!hasLevel(def, 'business')) return platformValue;
  const upper = ok(layers.limit) ? layers.limit : platformValue;
  if (stopAt === 'business') return upper;
  let eff = cap(def, ok(layers.business) ? layers.business : platformValue, upper);
  if (stopAt === 'shop') return eff;
  if (hasLevel(def, 'shop') && ok(layers.shop)) eff = cap(def, layers.shop, eff);
  if (stopAt === 'role') return eff;
  const roles = (layers.roles ?? []).filter(ok);
  if (hasLevel(def, 'role') && roles.length) eff = cap(def, roles.reduce((a, b) => looser(def, a, b)), eff);
  if (stopAt === 'user') return eff;
  if (hasLevel(def, 'user') && ok(layers.user)) eff = cap(def, layers.user, eff);
  return eff;
}

// ------------------------------------------------------------------ api shapes


// one key as a screen shows it
export interface PolicyEntry {
  key: string;
  // the value set at this level, null when it comes from above
  value: PolicyValue | null;
  // what applies when nothing is set here, and the bound a value here has to stay inside
  inherited: PolicyValue;
  // the value in force here
  effective: PolicyValue;
  editable: boolean;
}

// the super admin's view of one key for one business
export interface BusinessPolicyControl {
  key: string;
  limit: PolicyValue | null;
  delegated: boolean;
  business: PolicyValue;
  platform: PolicyValue;
}

export interface PlatformPolicyEntry {
  key: string;
  value: PolicyValue | null;
  default: PolicyValue;
  effective: PolicyValue;
}
