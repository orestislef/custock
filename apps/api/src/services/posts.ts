// posts with translations, linked products, offer prices and the legal "was" price

import type { Audience, Channel, Post } from '@custock/core';
import type { Tenant } from '../lib/tenant';
import { parseJson } from '../lib/tenant';
import { fileUrl } from './catalog';

const DAY = 86_400_000;

// EU omnibus rule: the reference price of a reduction is the lowest price of the 30 days before it
export function wasPrice(t: Tenant, variantId: string, from: number, shopId: string | null = null): number | null {
  const row = t.get<{ low: number | null }>(
    `SELECT min(price_minor) AS low FROM price_history
      WHERE org_id = @org AND variant_id = @v AND source != 'offer'
        AND (shop_id IS NULL OR shop_id = @shop)
        AND valid_from < @from AND (valid_to IS NULL OR valid_to > @since)`,
    { v: variantId, from, since: from - 30 * DAY, shop: shopId },
  );
  return row?.low ?? null;
}

interface PostRow {
  id: string;
  kind: Post['kind'];
  status: Post['status'];
  default_locale: Post['defaultLocale'];
  channels: string;
  audience: string;
  cover_key: string | null;
  scheduled_at: number | null;
  valid_from: number | null;
  valid_until: number | null;
  author_id: string;
  author_name: string | null;
  approved_by: string | null;
  sent_at: number | null;
  recipients_count: number | null;
  created_at: number;
}

export interface PostLoadOpts {
  withStats: boolean;
  showPrices: boolean;
  // linked product names in this language
  locale?: string;
  // customers do not see audience filters (tags, interests), only the scopes
  publicAudience?: boolean;
}

const EMPTY_AUDIENCE: Audience = { scopes: [], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null };

export function loadPosts(t: Tenant, ids: string[], opts: PostLoadOpts): Post[] {
  if (!ids.length) return [];
  const rows = t.all<PostRow>(
    `SELECT p.id, p.kind, p.status, p.default_locale, p.channels, p.audience, f.storage_key AS cover_key, p.scheduled_at,
            p.valid_from, p.valid_until, p.author_id, u.display_name AS author_name, p.approved_by, p.sent_at,
            p.recipients_count, p.created_at
       FROM posts p LEFT JOIN files f ON f.id = p.cover_file_id LEFT JOIN users u ON u.id = p.author_id
      WHERE p.org_id = @org AND p.deleted_at IS NULL AND p.id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  );
  const texts = t.all<{ post_id: string; locale: string; title: string; body: string }>(
    `SELECT tr.post_id, tr.locale, tr.title, tr.body FROM post_translations tr JOIN posts p ON p.id = tr.post_id
      WHERE p.org_id = @org AND tr.post_id IN (SELECT value FROM json_each(@ids))`,
    { ids },
  );
  const products = t.all<{ post_id: string; variant_id: string; offer_price_minor: number | null; product_id: string; name: string; price_minor: number | null; storage_key: string | null; options: string | null }>(
    `SELECT pp.post_id, pp.variant_id, pp.offer_price_minor, v.product_id,
            coalesce((SELECT ptr.name FROM product_translations ptr WHERE ptr.product_id = pr.id AND ptr.locale = @loc), pr.name) AS name, v.price_minor, v.options,
            (SELECT f.storage_key FROM product_images i JOIN files f ON f.id = i.file_id WHERE i.product_id = pr.id ORDER BY i.sort LIMIT 1) AS storage_key
       FROM post_products pp JOIN product_variants v ON v.id = pp.variant_id JOIN products pr ON pr.id = v.product_id
      WHERE pr.org_id = @org AND pp.post_id IN (SELECT value FROM json_each(@ids)) ORDER BY pp.sort`,
    { ids, loc: opts.locale ?? '' },
  );
  const stats = opts.withStats
    ? t.all<{ post_id: string; status: string; n: number }>(
        `SELECT post_id, status, count(*) AS n FROM deliveries WHERE org_id = @org AND post_id IN (SELECT value FROM json_each(@ids)) GROUP BY post_id, status`,
        { ids },
      )
    : [];

  const order = new Map(ids.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((r) => {
      const audience = parseJson<Audience>(r.audience, EMPTY_AUDIENCE);
      const s = stats.filter((x) => x.post_id === r.id);
      const sum = (...st: string[]) => s.filter((x) => st.includes(x.status)).reduce((a, x) => a + x.n, 0);
      const from = r.valid_from ?? r.sent_at ?? r.scheduled_at ?? r.created_at;
      return {
        id: r.id,
        orgId: t.orgId,
        kind: r.kind,
        status: r.status,
        defaultLocale: r.default_locale,
        translations: Object.fromEntries(texts.filter((x) => x.post_id === r.id).map((x) => [x.locale, { title: x.title, body: x.body }])),
        channels: parseJson<Channel[]>(r.channels, ['feed']),
        audience: opts.publicAudience ? { ...EMPTY_AUDIENCE, scopes: audience.scopes } : { ...EMPTY_AUDIENCE, ...audience },
        products: products
          .filter((p) => p.post_id === r.id)
          .map((p) => ({
            variantId: p.variant_id,
            productId: p.product_id,
            name: p.name,
            imageUrl: fileUrl(p.storage_key),
            priceMinor: opts.showPrices ? p.price_minor : null,
            offerPriceMinor: opts.showPrices || r.kind === 'offer' ? p.offer_price_minor : null,
            wasMinor: p.offer_price_minor != null ? wasPrice(t, p.variant_id, from) : null,
          })),
        coverUrl: fileUrl(r.cover_key),
        scheduledAt: r.scheduled_at,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
        authorId: r.author_id,
        authorName: r.author_name,
        approvedBy: r.approved_by,
        sentAt: r.sent_at,
        recipientsCount: r.recipients_count,
        stats: opts.withStats
          ? { queued: sum('queued', 'held'), sent: sum('sent', 'opened', 'clicked'), failed: sum('failed', 'bounced'), opened: sum('opened', 'clicked'), skipped: sum('skipped') }
          : null,
        createdAt: r.created_at,
      } satisfies Post;
    });
}

// shops a post reaches, from post_scopes when sent, from the audience otherwise
export function postShops(t: Tenant, post: Pick<Post, 'id' | 'audience' | 'status'>, topology: { orgId: string; shops: readonly string[]; groups: Readonly<Record<string, readonly string[]>> }): string[] {
  let scopes = post.audience.scopes;
  if (post.status === 'sent' || post.status === 'sending') {
    const rows = t.all<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string }>('SELECT scope_type, scope_id FROM post_scopes WHERE org_id = @org AND post_id = @p', { p: post.id });
    if (rows.length) scopes = rows.map((x) => ({ scopeType: x.scope_type, scopeId: x.scope_id }));
  }
  const out = new Set<string>();
  for (const s of scopes) {
    if (s.scopeType === 'org') topology.shops.forEach((x) => out.add(x));
    else if (s.scopeType === 'group') (topology.groups[s.scopeId] ?? []).forEach((x) => out.add(x));
    else out.add(s.scopeId);
  }
  return [...out];
}
