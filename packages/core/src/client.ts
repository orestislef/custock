// fetch based implementation of CustockApi. runs on node, browsers and react native.

import type { CustockApi, CustomerQuery, ProductQuery } from './api';
import type { ErrorCode, Locale, Problem } from './contract';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly problem: Problem | null;
  constructor(status: number, code: ErrorCode, problem: Problem | null) {
    super(problem?.detail ?? problem?.title ?? code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  getLocale?: () => Locale | string | null | undefined;
  // perms version per org, sent as X-Perms-Version
  getPermsVersion?: (orgId: string) => number | null | undefined;
  onUnauthorized?: () => void | Promise<void>;
  // called when the server says the caller's permissions changed
  onPermsStale?: (orgId: string) => void;
  // extra headers on every request, for example the forwarded client address from a server
  headers?: Record<string, string> | (() => Record<string, string> | undefined | Promise<Record<string, string> | undefined>);
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

export function createApiClient(opts: ApiClientOptions): CustockApi & {
  request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T>;
} {
  const base = opts.baseUrl.replace(/\/$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const extra = typeof opts.headers === 'function' ? await opts.headers() : opts.headers;
    const headers: Record<string, string> = { ...(extra ?? {}), Accept: 'application/json' };
    const token = await opts.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const locale = opts.getLocale?.();
    if (locale) headers['Accept-Language'] = String(locale);
    const orgMatch = path.match(/^\/v1\/orgs\/([^/]+)/);
    const orgId = orgMatch ? decodeURIComponent(orgMatch[1]!) : null;
    if (orgId) {
      const v = opts.getPermsVersion?.(orgId);
      if (v != null) headers['X-Perms-Version'] = String(v);
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await doFetch(`${base}${path}${qs(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (orgId && res.headers.get('X-Perms-Stale') === '1') opts.onPermsStale?.(orgId);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const problem = (data && typeof data === 'object' && 'code' in data ? data : null) as Problem | null;
      const code = (problem?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'internal')) as ErrorCode;
      if (res.status === 401) await opts.onUnauthorized?.();
      throw new ApiError(res.status, code, problem);
    }
    return data as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
  const del = <T>(path: string) => request<T>('DELETE', path);
  const org = (orgId: string) => `/v1/orgs/${enc(orgId)}`;

  return {
    request,

    // auth
    login: (email, password) => post('/v1/auth/login', { email, password }),
    requestOtp: (email, locale) => post('/v1/auth/otp/request', { email, locale }),
    verifyOtp: (email, code) => post('/v1/auth/otp/verify', { email, code }),
    refresh: (refreshToken) => post('/v1/auth/refresh', { refreshToken }),
    logout: () => post('/v1/auth/logout'),
    me: () => get('/v1/me/context'),

    // org
    orgSettings: (orgId) => get(org(orgId)),
    updateOrgSettings: (orgId, p) => patch(org(orgId), p),
    shops: (orgId, o) => get(`${org(orgId)}/shops`, { all: o?.all ? 1 : undefined }),
    groups: (orgId) => get(`${org(orgId)}/groups`),
    updateShop: (orgId, shopId, p) => patch(`${org(orgId)}/shops/${enc(shopId)}`, p),

    // catalog and stock
    categories: (orgId) => get(`${org(orgId)}/categories`),
    products: (orgId, q?: ProductQuery) => get(`${org(orgId)}/products`, q as Query),
    product: (orgId, productId) => get(`${org(orgId)}/products/${enc(productId)}`),
    createProduct: (orgId, input) => post(`${org(orgId)}/products`, input),
    updateProduct: (orgId, productId, p) => patch(`${org(orgId)}/products/${enc(productId)}`, p),
    setShopPrice: (orgId, shopId, variantId, priceMinor) =>
      put(`${org(orgId)}/shops/${enc(shopId)}/variants/${enc(variantId)}/settings`, { priceOverrideMinor: priceMinor }),
    scan: (orgId, code, symbology, shopId) => post(`${org(orgId)}/scan`, { code, symbology, shopId }),
    attachBarcode: (orgId, variantId, code, packQty) => post(`${org(orgId)}/variants/${enc(variantId)}/barcodes`, { code, packQty }),
    postMovements: (orgId, movements) => post(`${org(orgId)}/movements`, { movements }),
    movements: (orgId, q) => get(`${org(orgId)}/movements`, q as Query),
    unknownScans: (orgId, shopId) => get(`${org(orgId)}/unknown-scans`, { shopId }),

    // customers
    customers: (orgId, q?: CustomerQuery) => get(`${org(orgId)}/customers`, q as Query),
    customer: (orgId, id) => get(`${org(orgId)}/customers/${enc(id)}`),
    addCustomerNote: (orgId, id, body) => post(`${org(orgId)}/customers/${enc(id)}/notes`, { body }),
    setCustomerTags: (orgId, id, tags) => put(`${org(orgId)}/customers/${enc(id)}/tags`, { tags }),
    joinLinks: (orgId) => get(`${org(orgId)}/join-links`),
    createJoinLink: (orgId, input) => post(`${org(orgId)}/join-links`, input),

    // posts
    posts: (orgId, q) => get(`${org(orgId)}/posts`, q as Query),
    post: (orgId, id) => get(`${org(orgId)}/posts/${enc(id)}`),
    createPost: (orgId, input) => post(`${org(orgId)}/posts`, input),
    updatePost: (orgId, id, input) => patch(`${org(orgId)}/posts/${enc(id)}`, input),
    previewAudience: (orgId, audience, channels) => post(`${org(orgId)}/posts/audience-preview`, { audience, channels }),
    publishPost: (orgId, id) => post(`${org(orgId)}/posts/${enc(id)}/publish`),
    approvePost: (orgId, id) => post(`${org(orgId)}/posts/${enc(id)}/approve`),
    cancelPost: (orgId, id) => post(`${org(orgId)}/posts/${enc(id)}/cancel`),

    // team
    members: (orgId) => get(`${org(orgId)}/members`),
    roles: (orgId) => get(`${org(orgId)}/roles`),
    grantableRoles: (orgId, scopeType, scopeId) => get(`${org(orgId)}/roles/grantable`, { scopeType, scopeId }),
    invite: (orgId, input) => post(`${org(orgId)}/invites`, input),
    assignRole: (orgId, membershipId, input) => post(`${org(orgId)}/members/${enc(membershipId)}/assignments`, input),
    removeAssignment: (orgId, membershipId, assignmentId) =>
      del(`${org(orgId)}/members/${enc(membershipId)}/assignments/${enc(assignmentId)}`),
    saveRole: (orgId, input) => post(`${org(orgId)}/roles`, input),

    // reports
    dashboard: (orgId, shopId) => get(`${org(orgId)}/reports/dashboard`, { shopId }),
    salesSeries: (orgId, shopId, days) => get(`${org(orgId)}/reports/sales`, { shopId, days }),
    topSellers: (orgId, shopId, days) => get(`${org(orgId)}/reports/top-sellers`, { shopId, days }),
    mostWanted: (orgId, shopId) => get(`${org(orgId)}/reports/most-wanted`, { shopId }),
    joinLinkStats: (orgId) => get(`${org(orgId)}/reports/join-links`),
    shrinkage: (orgId, shopId, days) => get(`${org(orgId)}/reports/shrinkage`, { shopId, days }),

    // customer side
    feed: (cursor) => get('/v1/c/feed', { cursor }),
    offers: () => get('/v1/c/offers'),
    catalog: (orgSlug, q) => get(`/v1/c/orgs/${enc(orgSlug)}/catalog`, q as Query),
    publicProduct: (orgSlug, productId) => get(`/v1/c/orgs/${enc(orgSlug)}/products/${enc(productId)}`),
    notifyMe: (variantId, shopId) => post('/v1/c/alerts', { variantId, shopId }),
    setFavorite: (productId, saved) => put(`/v1/c/favorites/${enc(productId)}`, { saved }),
    followedShops: () => get('/v1/c/shops'),
    unfollow: (scopeType, scopeId) => post('/v1/c/unfollow', { scopeType, scopeId }),
    setChannel: (orgId, channel, on) => put('/v1/c/channels', { orgId, channel, on }),
    exportMyData: () => get('/v1/me/export'),
    deleteMyAccount: () => del('/v1/me'),

    // public
    joinPage: (code) => get(`/v1/public/join/${enc(code)}`),
    join: (code, input) => post(`/v1/public/join/${enc(code)}`, input),
    confirmJoin: (token) => post('/v1/public/confirm', { token }),
    shelfProduct: (code) => get(`/v1/public/p/${enc(code)}`),

    // stage 2 additions
    updateMe: (p) => patch('/v1/me', p),

    archiveProduct: (orgId, productId) => post(`${org(orgId)}/products/${enc(productId)}/archive`),
    setBasePrice: (orgId, variantId, priceMinor) => patch(`${org(orgId)}/variants/${enc(variantId)}/price`, { priceMinor }),
    setShopVariantSettings: (orgId, shopId, variantId, input) => put(`${org(orgId)}/shops/${enc(shopId)}/variants/${enc(variantId)}/settings`, input),
    nextInternalBarcode: (orgId) => post(`${org(orgId)}/barcodes/internal`),
    resolveUnknownScan: (orgId, id, variantId) => post(`${org(orgId)}/unknown-scans/${enc(id)}/resolve`, { variantId }),
    sync: (orgId, shopId, cursor) => get(`${org(orgId)}/shops/${enc(shopId)}/sync`, { since: cursor ?? undefined }),

    counts: (orgId, q) => get(`${org(orgId)}/counts`, q as Query),
    stockCount: (orgId, id) => get(`${org(orgId)}/counts/${enc(id)}`),
    startCount: (orgId, shopId, input) => post(`${org(orgId)}/shops/${enc(shopId)}/counts`, input),
    setCountLine: (orgId, id, variantId, countedQty, mode) => put(`${org(orgId)}/counts/${enc(id)}/lines/${enc(variantId)}`, { countedQty, mode: mode ?? 'set' }),
    submitCount: (orgId, id) => post(`${org(orgId)}/counts/${enc(id)}/submit`),
    applyCount: (orgId, id, uncountedPolicy) => post(`${org(orgId)}/counts/${enc(id)}/apply`, { uncountedPolicy }),
    cancelCount: (orgId, id) => post(`${org(orgId)}/counts/${enc(id)}/cancel`),

    transfers: (orgId, q) => get(`${org(orgId)}/transfers`, q as Query),
    transfer: (orgId, id) => get(`${org(orgId)}/transfers/${enc(id)}`),
    createTransfer: (orgId, input) => post(`${org(orgId)}/transfers`, input),
    sendTransfer: (orgId, id) => post(`${org(orgId)}/transfers/${enc(id)}/send`),
    receiveTransfer: (orgId, id, lines) => post(`${org(orgId)}/transfers/${enc(id)}/receive`, { lines }),
    cancelTransfer: (orgId, id) => post(`${org(orgId)}/transfers/${enc(id)}/cancel`),

    addCustomer: (orgId, input) => post(`${org(orgId)}/customers`, input),
    eraseCustomer: (orgId, id) => post(`${org(orgId)}/customers/${enc(id)}/erase`),
    updateJoinLink: (orgId, id, p) => patch(`${org(orgId)}/join-links/${enc(id)}`, p),

    deletePost: (orgId, id) => del(`${org(orgId)}/posts/${enc(id)}`),

    invites: (orgId) => get(`${org(orgId)}/invites`),
    revokeInvite: (orgId, id) => post(`${org(orgId)}/invites/${enc(id)}/revoke`),
    acceptInvite: (token) => post('/v1/invites/accept', { token }),
    updateMember: (orgId, membershipId, p) => patch(`${org(orgId)}/members/${enc(membershipId)}`, p),
    roleImpact: (orgId, roleId) => get(`${org(orgId)}/roles/${enc(roleId)}/impact`),

    audit: (orgId, cursor) => get(`${org(orgId)}/audit`, { cursor }),
    devOutbox: (limit) => get('/v1/dev/outbox', { limit }),
    devRunJobs: () => post('/v1/dev/run-jobs'),

    joinAsCustomer: (code, input) => post(`/v1/c/join/${enc(code)}`, input ?? {}),
    follow: (scopeType, scopeId) => post('/v1/c/follow', { scopeType, scopeId }),
    alerts: () => get('/v1/c/alerts'),
    cancelAlert: (id) => del(`/v1/c/alerts/${enc(id)}`),
    favorites: () => get('/v1/c/favorites'),

    unsubscribePage: (token) => get(`/v1/public/subscription/${enc(token)}`),
    unsubscribe: (token, everything) => post(`/v1/public/subscription/${enc(token)}`, { everything: !!everything }),

    requestEmailChange: (newEmail) => post('/v1/me/email', { email: newEmail }),
    confirmEmailChange: (newEmail, code) => post('/v1/me/email/verify', { email: newEmail, code }),
    detachBarcode: (orgId, variantId, barcodeId) => del(`${org(orgId)}/variants/${enc(variantId)}/barcodes/${enc(barcodeId)}`),
    presignUpload: (orgId, input) => post(`${org(orgId)}/uploads/presign`, input),
    negativeReview: (orgId, shopId) => get(`${org(orgId)}/review/negative`, { shopId }),

    pushKey: async () => {
      try {
        return await get<{ publicKey: string }>('/v1/push/key');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    savePushSubscription: (input) => request('POST', '/v1/me/push-subscriptions', input),
    deletePushSubscription: (endpoint) => request('DELETE', '/v1/me/push-subscriptions', { endpoint }),

    invitePreview: (token) => get(`/v1/invites/${enc(token)}`),
    registerWithInvite: (input) => post('/v1/invites/register', input),
    createShop: (orgId, input) => post(`${org(orgId)}/shops`, input),
  };
}
