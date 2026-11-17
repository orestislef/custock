// GET /v1/openapi.json: every registered route, with the zod contract as JSON schema where we
// know which schema goes in and which comes out. built once, on the first request.

import type { Hono } from 'hono';
import { z } from 'zod';
import * as contract from '@custock/core';
import type { AppEnv } from './types';

type Ref = { $ref: string } | { type: 'array'; items: { $ref: string } } | Record<string, unknown>;

const ref = (name: string): Ref => ({ $ref: `#/components/schemas/${name}` });
const list = (name: string): Ref => ({ type: 'array', items: ref(name) });
const paged = (name: string): Ref => ({
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: { items: { type: 'array', items: ref(name) }, nextCursor: { type: ['string', 'null'] } },
});

// METHOD path -> [request body, response body]
const IO: Record<string, [Ref | null, Ref | null]> = {
  'POST /v1/auth/login': [ref('LoginInput'), ref('Tokens')],
  'POST /v1/auth/otp/request': [ref('OtpRequestInput'), null],
  'POST /v1/auth/otp/verify': [ref('OtpVerifyInput'), ref('Tokens')],
  'POST /v1/auth/refresh': [{ type: 'object', properties: { refreshToken: { type: 'string' } } }, ref('Tokens')],
  'GET /v1/me/context': [null, ref('MeContext')],
  'GET /v1/orgs/{org}': [null, ref('OrgSettings')],
  'PATCH /v1/orgs/{org}': [ref('OrgSettings'), ref('OrgSettings')],
  'GET /v1/orgs/{org}/shops': [null, list('Shop')],
  'PATCH /v1/orgs/{org}/shops/{shop}': [ref('Shop'), ref('Shop')],
  'GET /v1/orgs/{org}/groups': [null, list('ShopGroup')],
  'GET /v1/orgs/{org}/categories': [null, list('Category')],
  'GET /v1/orgs/{org}/products': [null, paged('Product')],
  'POST /v1/orgs/{org}/products': [ref('ProductInput'), ref('Product')],
  'GET /v1/orgs/{org}/products/{id}': [null, ref('Product')],
  'PATCH /v1/orgs/{org}/products/{id}': [ref('ProductInput'), ref('Product')],
  'PUT /v1/orgs/{org}/shops/{shop}/variants/{variant}/settings': [ref('ShopVariantSettingsInput'), null],
  'POST /v1/orgs/{org}/scan': [{ type: 'object', properties: { code: { type: 'string' }, symbology: { type: 'string' }, shopId: { type: 'string' } } }, ref('ScanResult')],
  'POST /v1/orgs/{org}/movements': [{ type: 'object', properties: { movements: list('MovementInput') } }, ref('MovementBatchResult')],
  'GET /v1/orgs/{org}/movements': [null, paged('Movement')],
  'GET /v1/orgs/{org}/shops/{shop}/sync': [null, ref('SyncResult')],
  'GET /v1/orgs/{org}/counts': [null, list('StockCount')],
  'GET /v1/orgs/{org}/counts/{id}': [null, ref('StockCount')],
  'POST /v1/orgs/{org}/shops/{shop}/counts': [null, ref('StockCount')],
  'PUT /v1/orgs/{org}/counts/{id}/lines/{variant}': [null, ref('StockCountLine')],
  'POST /v1/orgs/{org}/counts/{id}/apply': [{ type: 'object', properties: { uncountedPolicy: ref('UncountedPolicy') } }, ref('StockCount')],
  'GET /v1/orgs/{org}/transfers': [null, list('Transfer')],
  'POST /v1/orgs/{org}/transfers': [ref('TransferInput'), ref('Transfer')],
  'GET /v1/orgs/{org}/transfers/{id}': [null, ref('Transfer')],
  'GET /v1/orgs/{org}/customers': [null, paged('Customer')],
  'POST /v1/orgs/{org}/customers': [ref('AddCustomerInput'), ref('Customer')],
  'GET /v1/orgs/{org}/customers/{id}': [null, ref('CustomerDetail')],
  'GET /v1/orgs/{org}/join-links': [null, list('JoinLink')],
  'POST /v1/orgs/{org}/join-links': [null, ref('JoinLink')],
  'GET /v1/orgs/{org}/posts': [null, paged('Post')],
  'POST /v1/orgs/{org}/posts': [ref('PostInput'), ref('Post')],
  'GET /v1/orgs/{org}/posts/{id}': [null, ref('Post')],
  'PATCH /v1/orgs/{org}/posts/{id}': [ref('PostInput'), ref('Post')],
  'POST /v1/orgs/{org}/posts/audience-preview': [{ type: 'object', properties: { audience: ref('Audience'), channels: { type: 'array', items: { type: 'string' } } } }, ref('AudiencePreview')],
  'POST /v1/orgs/{org}/posts/{id}/publish': [null, ref('Post')],
  'POST /v1/orgs/{org}/posts/{id}/approve': [null, ref('Post')],
  'POST /v1/orgs/{org}/posts/{id}/cancel': [null, ref('Post')],
  'GET /v1/orgs/{org}/members': [null, list('Member')],
  'GET /v1/orgs/{org}/roles': [null, list('Role')],
  'GET /v1/orgs/{org}/roles/grantable': [null, list('GrantableRole')],
  'GET /v1/orgs/{org}/invites': [null, list('Invite')],
  'POST /v1/orgs/{org}/invites': [ref('InviteInput'), null],
  'GET /v1/orgs/{org}/audit': [null, paged('AuditEntry')],
  'GET /v1/orgs/{org}/reports/dashboard': [null, ref('DashboardCards')],
  'GET /v1/orgs/{org}/reports/sales': [null, list('SeriesPoint')],
  'POST /v1/orgs/{org}/uploads/presign': [ref('PresignInput'), ref('PresignResult')],
  'GET /v1/dev/outbox': [null, list('DevOutboxItem')],
  'GET /v1/c/feed': [null, paged('FeedItem')],
  'GET /v1/c/offers': [null, list('FeedItem')],
  'GET /v1/c/alerts': [null, list('StockAlertItem')],
  'GET /v1/c/favorites': [null, list('PublicProduct')],
  'GET /v1/c/orgs/{slug}/catalog': [null, list('PublicProduct')],
  'GET /v1/c/orgs/{slug}/products/{id}': [null, ref('PublicProduct')],
  'GET /v1/public/join/{code}': [null, ref('JoinPage')],
  'POST /v1/public/join/{code}': [ref('JoinInput'), null],
  'GET /v1/public/p/{code}': [null, ref('PublicProduct')],
  'GET /v1/public/orgs/{slug}/catalog': [null, list('PublicProduct')],
  'GET /v1/public/subscription/{token}': [null, ref('UnsubscribePage')],
};

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

const PUBLIC = (path: string) => path.startsWith('/v1/public') || path.startsWith('/v1/auth/login') || path.startsWith('/v1/auth/otp') || path === '/v1/auth/refresh' || path === '/v1/openapi.json' || path === '/health';

function tagOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts[1] === 'orgs' && parts.length > 3) return parts[3] === 'shops' && parts.length > 5 ? parts[5]! : parts[3]!;
  return parts[1] ?? 'misc';
}

export function buildOpenApi(app: Hono<AppEnv>, version = '0.1.0'): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === 'ALL' || r.path.includes('*')) continue;
    const path = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const key = `${r.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [body, res] = IO[key] ?? [null, null];
    const params = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    paths[path] ??= {};
    paths[path]![r.method.toLowerCase()] = {
      operationId: key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      tags: [tagOf(path)],
      ...(PUBLIC(path) ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
      responses: {
        [r.method === 'DELETE' ? '204' : '200']: res ? { description: 'ok', content: { 'application/json': { schema: res } } } : { description: 'ok' },
        default: { description: 'problem', content: { 'application/problem+json': { schema: ref('Problem') } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Custock API', version, description: 'CRM and inventory for shops. Errors are problem+json with a stable code.' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: components(),
    },
    security: [{ bearer: [] }],
    paths,
  };
}
