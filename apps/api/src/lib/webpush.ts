// web push (VAPID) for the installed web app: where a tap on a push opens, what the browser gets,
// and which users can be reached. building is pure and tested. sending lives in live.ts and only
// runs in live mode.

import { createECDH, createHash } from 'node:crypto';
import type { Db } from '@custock/db';
import { iconVersion } from '@custock/core';
import { pickLocale, translator } from '@custock/i18n';
import { parseJson, platform } from './tenant';
import { orgLogoUrl } from '../services/catalog';

let webBase = 'http://localhost:3000';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// CUSTOCK_PUBLIC_WEB_URL, including a base path like /custock
export function setWebBase(url: string | undefined) {
  if (url) webBase = url.replace(/\/$/, '');
}

interface LinkPayload {
  type?: string;
  postId?: string;
  productId?: string;
  variantId?: string;
  countId?: string;
  transferId?: string;
  shopId?: string;
  membershipId?: string;
  [k: string]: unknown;
}

// a page in the staff app. the business (org) and, when it matters, the shop travel along, so a tap
// opens the right business and shop even when another one was open on that device.
export function staffPath(path: string, orgId: string | null, shopId?: string | null, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  if (orgId) q.set('org', orgId);
  if (shopId) q.set('shop', shopId);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

// the page a tap opens, relative to the web base. customers land on the business's pages, staff in
// /admin on the exact item: the post to approve, the count to review, the transfer, the product.
export function pushPath(db: Db, orgId: string | null, customer: boolean, p: LinkPayload): string {
  const slug = orgId ? platform(db).get<{ slug: string }>('SELECT slug FROM organizations WHERE id = @o', { o: orgId })?.slug : undefined;
  const enc = encodeURIComponent;
  const shop = typeof p.shopId === 'string' ? p.shopId : null;
  switch (p.type) {
    case 'post':
      if (customer && slug && p.postId) return `/s/${enc(slug)}/news?post=${enc(p.postId)}`;
      if (!customer && p.postId) return staffPath(`/admin/posts/${enc(p.postId)}`, orgId);
      break;
    case 'back_in_stock':
      if (slug && p.productId) return `/s/${enc(slug)}/p/${enc(p.productId)}`;
      break;
    case 'approvalNeeded':
    case 'postPublished':
    case 'postScheduled':
    case 'postReturned':
      if (p.postId) return staffPath(`/admin/posts/${enc(p.postId)}`, orgId);
      return staffPath('/admin/posts', orgId);
    case 'countReady':
      if (p.countId) return staffPath(`/admin/stock/counts/${enc(p.countId)}`, orgId, shop);
      return staffPath('/admin/stock/counts', orgId, shop);
    case 'transferSent':
    case 'transferReceived':
      if (p.transferId) return staffPath(`/admin/stock/transfers/${enc(p.transferId)}`, orgId, shop);
      return staffPath('/admin/stock/transfers', orgId, shop);
    case 'lowStock': {
      const product = p.variantId && orgId
        ? platform(db).get<{ product_id: string }>('SELECT product_id FROM product_variants WHERE org_id = @o AND id = @v', { o: orgId, v: p.variantId })?.product_id
        : undefined;
      return product ? staffPath(`/admin/stock/${enc(product)}`, orgId, shop) : staffPath('/admin/stock', orgId, shop, { filter: 'low' });
    }
    case 'inviteAccepted':
      return staffPath('/admin/team', orgId, null, { member: typeof p.membershipId === 'string' ? p.membershipId : undefined });
  }
  if (customer && slug) return `/s/${enc(slug)}`;
  return staffPath('/admin', orgId);
}

export interface PushAction { action: string; title: string; url: string }

// what makes a push recognisable: the business's own icon for everything that belongs to one (its
// logo, or its monogram, with the version in the url so a new logo shows), custock's icon for the
// super admin and the staff app's test push. buttons where the browser shows them: customers get
// View, and Offers on a post; staff get Open.
export function pushDecorations(db: Db, orgId: string | null, customer: boolean, locale: string | null | undefined, p: LinkPayload & { url?: string }): { icon: string; actions: PushAction[] } {
  const org = orgId ? platform(db).get<{ slug: string; name: string }>('SELECT slug, name FROM organizations WHERE id = @o', { o: orgId }) : undefined;
  const enc = encodeURIComponent;
  const icon = org
    ? `${webBase}/s/${enc(org.slug)}/icon/192?v=${iconVersion(org.name, orgLogoUrl(db, orgId!))}`
    : `${webBase}/icons/icon-192.png`;
  const tr = translator(pickLocale(locale), 'server');
  const url = typeof p.url === 'string' ? p.url : pushUrl(db, orgId, customer, p);
  const actions: PushAction[] = customer
    ? [
        { action: 'view', title: tr('push.action.view'), url },
        ...(p.type === 'post' && org ? [{ action: 'offers', title: tr('push.action.offers'), url: `${webBase}/s/${enc(org.slug)}/offers` }] : []),
      ]
    : [{ action: 'open', title: tr('push.action.open'), url }];
  return { icon, actions };
}

export function pushUrl(db: Db, orgId: string | null, customer: boolean, p: LinkPayload): string {
  return `${webBase}${pushPath(db, orgId, customer, p)}`;
}

export interface WebPushRow {
  org_id: string | null;
  customer_id: string | null;
  title: string | null;
  body: string | null;
  payload: string | null;
}

export interface WebPushMessage {
  // what the service worker gets, json
  payload: string;
  options: { TTL: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic: string };
}

const STAFF_TYPES = new Set(['approvalNeeded', 'postPublished', 'postScheduled', 'postReturned', 'countReady', 'transferSent', 'transferReceived', 'lowStock', 'inviteAccepted', 'platform_alert']);

function idOf(p: LinkPayload): string {
  return String(p.postId ?? p.productId ?? p.variantId ?? p.countId ?? p.transferId ?? p.membershipId ?? p.tag ?? '');
}

const absUrl = (v: unknown, max = 500): string | null => (typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= max ? v : null);

function cleanActions(v: unknown): PushAction[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is PushAction => !!a && typeof a.action === 'string' && typeof a.title === 'string' && !!absUrl(a.url))
    .slice(0, 2)
    .map((a) => ({ action: a.action.slice(0, 20), title: clip(a.title, 30), url: a.url }));
}

// the push service keeps only the newest message per topic while the phone is offline
export function topicOf(p: LinkPayload, orgId: string | null): string {
  return createHash('sha256').update(`${p.type ?? 'push'}|${orgId ?? ''}|${idOf(p)}|${String(p.shopId ?? '')}`).digest('base64url').slice(0, 32);
}


// one web push for one outbox row. null for silent pushes: browsers must show every push, a
// silent one would turn into a generic notice (or cost the subscription on iOS).
export function buildWebPush(row: WebPushRow): WebPushMessage | null {
  const p = parseJson<LinkPayload & { silent?: boolean; url?: string; image?: string | null; icon?: string; actions?: unknown; tag?: string }>(row.payload, {});
  if (p.silent || !(row.title || row.body)) return null;
  const staff = STAFF_TYPES.has(p.type ?? '');
  const message: Record<string, unknown> = {
    title: clip(row.title ?? '', 120),
    body: clip(row.body ?? '', 400),
    url: typeof p.url === 'string' ? p.url : null,
    tag: `${p.type ?? 'push'}:${idOf(p)}`,
    type: p.type ?? null,
    orgId: row.org_id,
    icon: absUrl(p.icon),
    image: absUrl(p.image),
    actions: cleanActions(p.actions),
  };
  let payload = JSON.stringify(message);
  // the encrypted record must stay under 4 kB: the picture goes first, then the buttons, then body
  for (const trim of [() => { message.image = null; }, () => { message.actions = []; }, () => { message.body = clip(String(message.body), 200); }, () => { message.body = clip(String(message.body), 80); }]) {
    if (Buffer.byteLength(payload) <= 3000) break;
    trim();
    payload = JSON.stringify(message);
  }
  const TTL = staff ? 12 * 3600 : p.type === 'back_in_stock' ? 3 * 86400 : 2 * 86400;
  return { payload, options: { TTL, urgency: staff ? 'high' : 'normal', topic: topicOf(p, row.org_id) } };
}

// the subscriptions one outbox row goes to: the user's, either for every business or for this one
export function subscriptionsFor(db: Db, userId: string, orgId: string | null) {
  return platform(db).all<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = @u AND (org_id IS NULL OR org_id = @o) ORDER BY created_at',
    { u: userId, o: orgId },
  );
}

// sql: can this user (column) get a push for this org (column), by the phone app or the web app
export function pushReachableSql(userCol: string, orgCol: string): string {
  return `(EXISTS (SELECT 1 FROM devices d WHERE d.user_id = ${userCol} AND d.revoked_at IS NULL AND d.fcm_token IS NOT NULL)
    OR EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = ${userCol} AND (ps.org_id IS NULL OR ps.org_id = ${orgCol})))`;
}

// customers.push_ok is consent plus a way to reach the person. recomputed for every business of
// a user when their devices or subscriptions change.
export function recomputePushOk(db: Db, userId: string, now: number) {
  platform(db).run(
    `UPDATE customers SET push_ok = CASE WHEN erased_at IS NULL AND coalesce((
         SELECT k.granted FROM consents k WHERE k.org_id = customers.org_id AND k.customer_id = customers.id AND k.channel = 'push'
          ORDER BY k.created_at DESC, k.id DESC LIMIT 1), 0) = 1
       AND ${pushReachableSql('customers.user_id', 'customers.org_id')} THEN 1 ELSE 0 END,
       updated_at = @now
     WHERE user_id = @u`,
    { u: userId, now },
  );
}

// a VAPID key pair, base64url: the public key is the raw P-256 point, the private key the scalar
export function newVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = ecdh.getPrivateKey();
  const padded = Buffer.concat([Buffer.alloc(Math.max(0, 32 - priv.length)), priv]);
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: padded.toString('base64url') };
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidProblems(v: Partial<VapidConfig>): string[] {
  const out: string[] = [];
  const b = (s: string | undefined) => (s && /^[A-Za-z0-9_-]+=*$/.test(s) ? Buffer.from(s, 'base64url') : null);
  const pub = b(v.publicKey);
  const priv = b(v.privateKey);
  if (!pub || pub.length !== 65 || pub[0] !== 4) out.push('CUSTOCK_VAPID_PUBLIC_KEY must be a base64url P-256 public key (pnpm --filter @custock/api vapid makes a pair)');
  if (!priv || priv.length !== 32) out.push('CUSTOCK_VAPID_PRIVATE_KEY must be a base64url P-256 private key');
  if (!v.subject || !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(v.subject)) out.push('CUSTOCK_VAPID_SUBJECT must be mailto:someone@example.com or an https url');
  return out;
}
