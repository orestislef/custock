// GET /v1/openapi.json: every registered route, read from the router itself so nothing can be
// missing. for each one: a summary, who may call it (x-access), the permission keys and problem
// codes its handler mentions (x-permissions, x-errors), path and query parameters, and the zod
// contract as JSON schema where we know which schema goes in and which comes out. built once, on
// the first request, after every route is registered.

import type { Hono } from 'hono';
import { z } from 'zod';
import * as contract from '@custock/core';
import { ErrorCode, PERMISSION_KEYS } from '@custock/core';
import type { AppEnv } from './types';
import { orgContext, requireAuth } from './lib/context';

type Schema = Record<string, unknown>;
type Access = 'public' | 'user' | 'org' | 'superadmin';

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const list = (name: string): Schema => ({ type: 'array', items: ref(name) });
const paged = (name: string): Schema => ({
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: { items: { type: 'array', items: ref(name) }, nextCursor: { type: ['string', 'null'] } },
});
const obj = (props: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties: props, ...(required.length ? { required } : {}) });
const str: Schema = { type: 'string' };
const linkOut = obj({ id: str, link: str, emailed: { type: 'boolean' } });

// METHOD path -> [request body, response body]
const IO: Record<string, [Schema | null, Schema | null]> = {
  'POST /v1/auth/login': [ref('LoginInput'), ref('Tokens')],
  'POST /v1/auth/otp/request': [ref('OtpRequestInput'), null],
  'POST /v1/auth/otp/verify': [ref('OtpVerifyInput'), ref('Tokens')],
  'POST /v1/auth/refresh': [obj({ refreshToken: str }, ['refreshToken']), ref('Tokens')],
  'GET /v1/me/context': [null, ref('MeContext')],
  'GET /v1/orgs/{org}': [null, ref('OrgSettings')],
  'PATCH /v1/orgs/{org}': [ref('OrgSettings'), ref('OrgSettings')],
  'GET /v1/orgs/{org}/shops': [null, list('Shop')],
  'POST /v1/orgs/{org}/shops': [ref('ShopInput'), ref('Shop')],
  'PATCH /v1/orgs/{org}/shops/{shop}': [ref('Shop'), ref('Shop')],
  'GET /v1/orgs/{org}/groups': [null, list('ShopGroup')],
  'GET /v1/orgs/{org}/categories': [null, list('Category')],
  'GET /v1/orgs/{org}/products': [null, paged('Product')],
  'POST /v1/orgs/{org}/products': [ref('ProductInput'), ref('Product')],
  'GET /v1/orgs/{org}/products/{id}': [null, ref('Product')],
  'PATCH /v1/orgs/{org}/products/{id}': [ref('ProductInput'), ref('Product')],
  'PUT /v1/orgs/{org}/shops/{shop}/variants/{variant}/settings': [ref('ShopVariantSettingsInput'), null],
  'POST /v1/orgs/{org}/scan': [obj({ code: str, symbology: str, shopId: str }, ['code']), ref('ScanResult')],
  'POST /v1/orgs/{org}/movements': [obj({ movements: list('MovementInput') }, ['movements']), ref('MovementBatchResult')],
  'GET /v1/orgs/{org}/movements': [null, paged('Movement')],
  'GET /v1/orgs/{org}/shops/{shop}/sync': [null, ref('SyncResult')],
  'GET /v1/orgs/{org}/counts': [null, list('StockCount')],
  'GET /v1/orgs/{org}/counts/{id}': [null, ref('StockCount')],
  'POST /v1/orgs/{org}/shops/{shop}/counts': [null, ref('StockCount')],
  'PUT /v1/orgs/{org}/counts/{id}/lines/{variant}': [null, ref('StockCountLine')],
  'POST /v1/orgs/{org}/counts/{id}/submit': [null, ref('StockCount')],
  'POST /v1/orgs/{org}/counts/{id}/apply': [obj({ uncountedPolicy: ref('UncountedPolicy') }), ref('StockCount')],
  'POST /v1/orgs/{org}/counts/{id}/cancel': [null, ref('StockCount')],
  'GET /v1/orgs/{org}/transfers': [null, list('Transfer')],
  'POST /v1/orgs/{org}/transfers': [ref('TransferInput'), ref('Transfer')],
  'GET /v1/orgs/{org}/transfers/{id}': [null, ref('Transfer')],
  'POST /v1/orgs/{org}/transfers/{id}/send': [null, ref('Transfer')],
  'POST /v1/orgs/{org}/transfers/{id}/receive': [null, ref('Transfer')],
  'POST /v1/orgs/{org}/transfers/{id}/cancel': [null, ref('Transfer')],
  'GET /v1/orgs/{org}/customers': [null, paged('Customer')],
  'POST /v1/orgs/{org}/customers': [ref('AddCustomerInput'), ref('Customer')],
  'GET /v1/orgs/{org}/customers/{id}': [null, ref('CustomerDetail')],
  'GET /v1/orgs/{org}/join-links': [null, list('JoinLink')],
  'POST /v1/orgs/{org}/join-links': [null, ref('JoinLink')],
  'PATCH /v1/orgs/{org}/join-links/{id}': [null, ref('JoinLink')],
  'GET /v1/orgs/{org}/posts': [null, paged('Post')],
  'POST /v1/orgs/{org}/posts': [ref('PostInput'), ref('Post')],
  'GET /v1/orgs/{org}/posts/{id}': [null, ref('Post')],
  'PATCH /v1/orgs/{org}/posts/{id}': [ref('PostInput'), ref('Post')],
  'POST /v1/orgs/{org}/posts/audience-preview': [obj({ audience: ref('Audience'), channels: { type: 'array', items: str } }), ref('AudiencePreview')],
  'POST /v1/orgs/{org}/posts/{id}/publish': [null, ref('Post')],
  'POST /v1/orgs/{org}/posts/{id}/approve': [null, ref('Post')],
  'POST /v1/orgs/{org}/posts/{id}/cancel': [null, ref('Post')],
  'GET /v1/orgs/{org}/members': [null, list('Member')],
  'GET /v1/orgs/{org}/roles': [null, list('Role')],
  'GET /v1/orgs/{org}/roles/grantable': [null, list('GrantableRole')],
  'GET /v1/orgs/{org}/invites': [null, list('Invite')],
  'POST /v1/orgs/{org}/invites': [ref('InviteInput'), ref('InviteCreated')],
  'GET /v1/invites/{token}': [null, ref('InvitePreview')],
  'POST /v1/invites/register': [ref('InviteRegisterInput'), ref('Tokens')],
  'POST /v1/invites/accept': [obj({ token: str }, ['token']), null],
  'GET /v1/orgs/{org}/audit': [null, paged('AuditEntry')],
  'GET /v1/orgs/{org}/reports/dashboard': [null, ref('DashboardCards')],
  'GET /v1/orgs/{org}/reports/sales': [null, list('SeriesPoint')],
  'GET /v1/orgs/{org}/controls': [null, ref('OrgControls')],
  'POST /v1/orgs/{org}/uploads/presign': [ref('PresignInput'), ref('PresignResult')],
  'POST /v1/me/uploads/presign': [ref('PresignInput'), ref('PresignResult')],
  'GET /v1/push/key': [null, obj({ publicKey: str }, ['publicKey'])],
  'POST /v1/me/push-subscriptions': [ref('PushSubscriptionInput'), null],
  'DELETE /v1/me/push-subscriptions': [obj({ endpoint: str }, ['endpoint']), null],
  'GET /v1/dev/outbox': [null, list('DevOutboxItem')],
  'GET /v1/c/feed': [null, paged('FeedItem')],
  'GET /v1/c/offers': [null, list('FeedItem')],
  'GET /v1/c/shops': [null, list('Shop')],
  'GET /v1/c/alerts': [null, list('StockAlertItem')],
  'GET /v1/c/favorites': [null, list('PublicProduct')],
  'GET /v1/c/orgs/{slug}/catalog': [null, list('PublicProduct')],
  'GET /v1/c/orgs/{slug}/products/{id}': [null, ref('PublicProduct')],
  'GET /v1/public/join/{code}': [null, ref('JoinPage')],
  'POST /v1/public/join/{code}': [ref('JoinInput'), null],
  'GET /v1/public/p/{code}': [null, ref('PublicProduct')],
  'GET /v1/public/orgs/{slug}/catalog': [null, list('PublicProduct')],
  'GET /v1/public/subscription/{token}': [null, ref('UnsubscribePage')],
  'GET /v1/platform/overview': [null, ref('PlatformOverview')],
  'GET /v1/platform/businesses': [null, list('PlatformBusiness')],
  'POST /v1/platform/businesses': [ref('NewBusinessInput'), ref('BusinessCreated')],
  'POST /v1/platform/businesses/{orgId}/owner-invites': [ref('PlatformInviteInput'), linkOut],
  'POST /v1/platform/businesses/{orgId}/owner-invites/{id}/resend': [null, linkOut],
  'PATCH /v1/platform/businesses/{orgId}/controls': [ref('OrgControlsPatch'), ref('OrgControls')],
  'GET /v1/platform/settings': [null, ref('PlatformSettings')],
  'PATCH /v1/platform/settings': [null, ref('PlatformSettings')],
  'GET /v1/platform/audit': [null, paged('PlatformAuditEntry')],
  'GET /v1/platform/superadmins': [null, ref('SuperAdmins')],
  'POST /v1/platform/superadmin-invites': [ref('PlatformInviteInput'), linkOut],
  'POST /v1/platform/superadmin-invites/{id}/resend': [null, linkOut],
  'GET /v1/platform-invites/{token}': [null, ref('PlatformInvitePreview')],
  'GET /v1/platform/errors': [null, ref('IssuePage')],
  'GET /v1/platform/server': [null, ref('ServerInfo')],
  'GET /v1/openapi.json': [null, obj({ openapi: str, info: { type: 'object' }, paths: { type: 'object' } })],
  'GET /v1/orgs/{org}/orders': [null, paged('OrderSummary')],
  'GET /v1/orgs/{org}/orders/counts': [null, ref('OrderCounts')],
  'GET /v1/orgs/{org}/orders/{id}': [null, ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/quote': [ref('OrderQuoteInput'), ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/confirm': [null, ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/decline': [ref('OrderReasonInput'), ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/ready': [null, ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/complete': [null, ref('Order')],
  'POST /v1/orgs/{org}/orders/{id}/cancel': [ref('OrderReasonInput'), ref('Order')],
  'GET /v1/public/orgs/{slug}/order-options': [null, ref('PublicOrderOptions')],
  'GET /v1/public/orgs/{slug}/posts': [null, paged('FeedItem')],
  'POST /v1/c/orgs/{slug}/orders/preview': [ref('OrderPreviewInput'), ref('OrderPreview')],
  'POST /v1/c/orgs/{slug}/orders': [ref('OrderCreateInput'), ref('Order')],
  'GET /v1/c/orgs/{slug}/orders': [null, paged('OrderSummary')],
  'GET /v1/c/orgs/{slug}/orders/{id}': [null, ref('Order')],
  'POST /v1/c/orgs/{slug}/orders/{id}/accept': [null, ref('Order')],
  'POST /v1/c/orgs/{slug}/orders/{id}/reject': [null, ref('Order')],
  'POST /v1/c/orgs/{slug}/orders/{id}/cancel': [ref('OrderCustomerCancelInput'), ref('Order')],
};

// names a person reads instead of a guess from the path
const SUMMARY: Record<string, string> = {
  'GET /health': 'Health check',
  'GET /v1/openapi.json': 'This API description',
  'GET /v1/me/context': 'Who I am and where I work',
  'PATCH /v1/me': 'Update my name, language or photo',
  'DELETE /v1/me': 'Delete my account',
  'GET /v1/me/export': 'Export my data',
  'POST /v1/me/email': 'Ask to change my email',
  'POST /v1/me/email/verify': 'Confirm my new email',
  'POST /v1/me/push/test': 'Send me a test notification',
  'POST /v1/orgs/{org}/scan': 'Look up a scanned code',
  'GET /v1/orgs/{org}/orders/counts': 'Open orders per status',
  'POST /v1/orgs/{org}/orders/{id}/quote': 'Send the price of an order',
  'POST /v1/orgs/{org}/orders/{id}/complete': 'Hand over an order',
  'POST /v1/c/orgs/{slug}/orders/preview': 'Price an order before sending it',
  'POST /v1/c/orgs/{slug}/orders': 'Send an order',
  'POST /v1/c/orgs/{slug}/orders/{id}/accept': 'Say yes to a price',
  'POST /v1/c/orgs/{slug}/orders/{id}/reject': 'Say no to a price',
  'POST /v1/orgs/{org}/movements': 'Record stock movements',
  'GET /v1/orgs/{org}/shops/{shop}/sync': 'Changes since the last sync',
  'POST /v1/orgs/{org}/posts/audience-preview': 'Who a post would reach',
  'GET /v1/orgs/{org}/roles/grantable': 'Roles I may hand out',
  'GET /v1/orgs/{org}/roles/{id}/impact': 'Who a role change affects',
  'POST /v1/orgs/{org}/barcodes/internal': 'Next internal barcode',
  'GET /v1/orgs/{org}/review/negative': 'Movements that went below zero',
  'GET /v1/orgs/{org}/controls': 'What the super admin set for this business',
  'PUT /v1/uploads/{token}': 'Upload a photo into a signed slot',
  'GET /v1/push/key': 'The public key for web push',
  'POST /v1/public/confirm': 'Confirm a join from the email link',
  'GET /v1/public/subscription/{token}': 'Read an unsubscribe page',
  'POST /v1/public/subscription/{token}': 'Unsubscribe',
  'GET /v1/public/orgs/{slug}': 'A business page',
  'GET /v1/public/p/{code}': 'A shelf product page',
  'POST /v1/c/join/{code}': 'Join a business as a signed in customer',
  'PUT /v1/c/channels': 'Turn email or push on or off',
  'POST /v1/c/alerts': 'Notify me when back in stock',
  'PUT /v1/c/favorites/{product}': 'Save or unsave a product',
  'GET /v1/dev/outbox': 'Everything that would have been sent (dev)',
  'POST /v1/dev/run-jobs': 'Run due jobs now (dev)',
  'GET /v1/dev/emails': 'Every email template (dev)',
  'GET /v1/dev/emails/{kind}': 'One email template (dev)',
  'GET /email/{file}': 'Email images and fonts',
  'GET /files/uploads/{org}/{name}': 'A stored photo (local storage)',
  'GET /v1/public/join/{code}': 'A join page',
  'POST /v1/public/join/{code}': 'Join from a QR code or link',
  'GET /v1/invites/{token}': 'Read an invite',
  'GET /v1/platform-invites/{token}': 'Read a super admin invite',
  'POST /v1/client-errors': 'Report an error from the browser',
  'GET /v1/platform/slug': 'Suggest a web address for a name',
  'GET /v1/platform/server': 'This server',
  'PATCH /v1/platform/businesses/{orgId}/controls': 'Features, limits and pause for a business',
  'GET /v1/platform/settings': 'Platform wide pauses',
  'PATCH /v1/platform/settings': 'Change platform wide pauses',
};

// the last path word that names an action rather than a thing
const VERBS = new Set([
  'publish', 'approve', 'cancel', 'submit', 'apply', 'send', 'receive', 'archive', 'resolve', 'revoke', 'erase', 'resend', 'accept',
  'register', 'verify', 'confirm', 'follow', 'unfollow', 'test', 'logout', 'refresh', 'login', 'request', 'reset', 'forgot',
]);

const words = (seg: string) => seg.replace(/[-_]/g, ' ');
function singular(seg: string): string {
  const w = words(seg);
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
  if (/(ss|us)$/.test(w)) return w;
  if (/(ch|sh|x)es$/.test(w)) return w.replace(/es$/, '');
  return w.replace(/s$/, '');
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function summaryOf(method: string, path: string): string {
  const key = `${method} ${path}`;
  if (SUMMARY[key]) return SUMMARY[key]!;
  const segs = path.split('/').filter((s) => s && s !== 'v1');
  const isParam = (s?: string) => !!s && s.startsWith('{');
  const last = segs.at(-1) ?? '';
  if (isParam(last)) {
    const thing = singular(segs.filter((s) => !isParam(s)).at(-1) ?? 'item');
    return { GET: `Get one ${thing}`, PATCH: `Update one ${thing}`, PUT: `Set one ${thing}`, DELETE: `Delete one ${thing}`, POST: `Act on one ${thing}` }[method] ?? `${method} ${thing}`;
  }
  if (VERBS.has(last)) {
    const owner = segs.slice(0, -1).filter((s) => !isParam(s)).at(-1);
    return owner && owner !== 'auth' ? `${cap(last)} ${singular(owner)}` : cap(words(last));
  }
  const thing = words(last);
  return { GET: `List ${thing}`, POST: `Create ${singular(last)}`, PUT: `Set ${thing}`, PATCH: `Update ${thing}`, DELETE: `Delete ${thing}` }[method] ?? `${method} ${thing}`;
}

// stable tag ids, the docs screen translates them
export function tagOf(path: string): string {
  const segs = path.split('/').filter(Boolean);
  if (path === '/health' || path === '/v1/openapi.json') return 'system';
  if (segs[0] === 'email' || segs[0] === 'files') return 'files';
  const top = segs[1] ?? 'system';
  if (top === 'orgs') {
    const area = segs[3];
    if (!area) return 'business';
    if (area === 'shops') return segs[5] === 'counts' ? 'counts' : segs[5] === 'variants' ? 'products' : segs[5] === 'sync' ? 'stock' : 'business';
    const map: Record<string, string> = {
      products: 'products', variants: 'products', categories: 'products', barcodes: 'products', scan: 'stock', 'unknown-scans': 'stock',
      movements: 'stock', review: 'stock', counts: 'counts', transfers: 'transfers', customers: 'customers', 'join-links': 'join-links',
      posts: 'posts', members: 'team', roles: 'team', invites: 'team', audit: 'business', reports: 'reports', uploads: 'uploads',
      groups: 'business', controls: 'business', orders: 'orders',
    };
    return map[area] ?? 'business';
  }
  const map: Record<string, string> = {
    auth: 'auth', me: 'account', c: 'customer-app', public: 'public', platform: 'platform', 'platform-invites': 'platform',
    invites: 'team', dev: 'dev', push: 'push', uploads: 'uploads', 'client-errors': 'system',
  };
  return map[top] ?? 'system';
}

// hono patterns: ':name' is one segment, '*' anything (including nothing)
function patternMatches(pattern: string, path: string): boolean {
  if (pattern === '*' || pattern === '/*') return true;
  const p = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  const body = p
    .split('/')
    .map((s) => (s.startsWith(':') ? '[^/]+' : s === '*' ? '.*' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}${pattern.endsWith('/*') ? '(/.*)?' : ''}$`).test(path);
}

const PERMS = new Set(PERMISSION_KEYS);
const CODES = new Set<string>(ErrorCode.options);
const quoted = /['"`]([A-Za-z_][A-Za-z0-9_.-]*)['"`]/g;

function literals(fns: unknown[]): string[] {
  const out = new Set<string>();
  for (const fn of fns) {
    if (typeof fn !== 'function') continue;
    for (const m of String(fn).matchAll(quoted)) out.add(m[1]!);
  }
  return [...out];
}

function queryNames(fns: unknown[]): string[] {
  const out = new Set<string>();
  for (const fn of fns) {
    if (typeof fn !== 'function') continue;
    for (const m of String(fn).matchAll(/\.query\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\)/g)) out.add(m[1]!);
  }
  return [...out];
}

function accessOf(_method: string, rawPath: string, own: unknown[], all: { method: string; path: string; handler: unknown }[]): Access {
  if (rawPath.startsWith('/v1/platform/') || rawPath === '/v1/openapi.json') return 'superadmin';
  // app.use() middleware is registered as ALL; handlers given inline to app.get(path, mw, h) are `own`
  const mw = all.filter((r) => r.method === 'ALL' && patternMatches(r.path, rawPath)).map((r) => r.handler);
  const chain = [...mw, ...own];
  if (chain.includes(orgContext)) return 'org';
  if (chain.includes(requireAuth)) return 'user';
  // wrappers that call requireAuth themselves (the dev routes)
  if (mw.some((h) => typeof h === 'function' && /requireAuth\(/.test(String(h)))) return 'user';
  return 'public';
}

function components(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(contract)) {
    if (!(value instanceof z.ZodType)) continue;
    try {
      const schema = z.toJSONSchema(value, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
      delete schema.$schema;
      out[name] = schema;
    } catch {
      out[name] = {};
    }
  }
  return out;
}

// keeps only references the document can resolve
function resolvable(s: Schema | null, names: Set<string>): Schema | null {
  if (!s) return null;
  const text = JSON.stringify(s);
  for (const m of text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)) if (!names.has(m[1]!)) return null;
  return s;
}

export const docPath = (honoPath: string) => honoPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/\*$/, '/{path}').replace(/\*/g, '{path}');

export function buildOpenApi(app: Hono<AppEnv>, version = '0.1.0'): Record<string, unknown> {
  const schemas = components();
  const names = new Set(Object.keys(schemas));
  const routes = app.routes as { method: string; path: string; handler: unknown }[];

  // every handler registered for one method and path, middleware included
  const byKey = new Map<string, { method: string; raw: string; handlers: unknown[] }>();
  for (const r of routes) {
    if (r.method === 'ALL') continue;
    const key = `${r.method} ${r.path}`;
    const e = byKey.get(key) ?? { method: r.method, raw: r.path, handlers: [] };
    e.handlers.push(r.handler);
    byKey.set(key, e);
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, raw, handlers } of byKey.values()) {
    const path = docPath(raw);
    const key = `${method} ${path}`;
    const access = accessOf(method, raw, handlers, routes);
    const found = literals(handlers);
    const perms = found.filter((l) => PERMS.has(l));
    const errors = new Set(found.filter((l) => CODES.has(l)));
    if (access !== 'public') errors.add('unauthorized');
    if (access === 'org' || access === 'superadmin') errors.add('forbidden');
    const [body0, res0] = IO[key] ?? [null, null];
    const body = resolvable(body0, names);
    const res = resolvable(res0, names);
    if (body || ['POST', 'PUT', 'PATCH'].includes(method)) errors.add('validation');
    const params = [
      ...[...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({ name: m[1]!, in: 'path', required: true, schema: { type: 'string' } })),
      ...queryNames(handlers).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
    ];
    const permsLine = perms.length ? ` Needs ${perms.length > 1 ? 'one of ' : ''}${perms.join(', ')}.` : '';
    paths[path] ??= {};
    paths[path]![method.toLowerCase()] = {
      operationId: key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      summary: summaryOf(method, path),
      description: `${{ public: 'No sign in needed.', user: 'Signed in.', org: 'Signed in, works in the business.', superadmin: 'Super admins only.' }[access]}${permsLine}`,
      tags: [tagOf(path)],
      'x-access': access,
      ...(perms.length ? { 'x-permissions': perms } : {}),
      'x-errors': [...errors].sort(),
      ...(access === 'public' ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
      responses: {
        [method === 'DELETE' ? '204' : '200']: res ? { description: 'ok', content: { 'application/json': { schema: res } } } : { description: 'ok' },
        default: { description: 'problem', content: { 'application/problem+json': { schema: ref('Problem') } } },
      },
    };
  }

  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: { title: 'Custock API', version, description: 'CRM and inventory for shops. Errors are problem+json with a stable code.' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas,
    },
    security: [{ bearer: [] }],
    paths: sorted,
  };
}
