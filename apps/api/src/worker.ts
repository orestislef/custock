// the in-process job worker. one process, jobs live in the database.
// kinds: send_post (fan out into deliveries), send_deliveries (through the dev transport, in each
// recipient's language), rollup_day (daily stats from the ledger).

import { followsShop, shopsInScope, uuidv7, type Audience, type Channel } from '@custock/core';
import { translator, pickLocale } from '@custock/i18n';
import type { Db } from '@custock/db';
import type { Config, OrgRow } from './types';
import { loadTopology, ORG_COLUMNS } from './lib/context';
import { parseJson, platform, Tenant } from './lib/tenant';
import { dayKey, localDayStart, quietHoursEnd, inQuietHours } from './lib/time';
import { devOutboxTransport, type Transport } from './lib/transport';
import { drainOutbox, type LiveSender } from './lib/live';
import { setWebBase } from './lib/webpush';
import { unsubKey, unsubToken } from './lib/unsub';
import { canEmail, canPush, resolveAudience } from './services/audience';
import { fileUrl, variantLabel } from './services/catalog';

const DAY = 86_400_000;

export function enqueue(db: Db, kind: string, payload: unknown, runAt: number, dedupeKey?: string): string | null {
  const id = uuidv7();
  const res = platform(db).run(
    `INSERT OR IGNORE INTO jobs (id, kind, payload, run_at, created_at, dedupe_key) VALUES (@id, @kind, @payload, @run, @now, @dedupe)`,
    { id, kind, payload: JSON.stringify(payload ?? {}), run: runAt, now: Date.now(), dedupe: dedupeKey ?? null },
  );
  return res.changes ? id : null;
}

interface JobRow {
  id: string;
  kind: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

export interface WorkerDeps {
  cfg: Pick<Config, 'db' | 'jwtSecret' | 'publicWebUrl' | 'unsubSecret'>;
  // only with CUSTOCK_TRANSPORT=live: drains the outbox through the live channels
  live?: LiveSender;
  transport?: Transport;
  log?: (line: string) => void;
}

// runs every due job once. returns how many ran.
export async function runJobs(deps: WorkerDeps, now: number = Date.now()): Promise<number> {
  const db = deps.cfg.db;
  setWebBase(deps.cfg.publicWebUrl);
  const p = platform(db);
  ensureNightly(db, now);
  let ran = 0;
  // a few rounds so jobs queued by jobs (send_post -> send_deliveries) finish in one call
  for (let round = 0; round < 5; round++) {
    const due = p.all<JobRow>(
      `SELECT id, kind, payload, attempts, max_attempts FROM jobs
        WHERE done_at IS NULL AND run_at <= @now AND (locked_until IS NULL OR locked_until < @now) AND attempts < max_attempts
        ORDER BY run_at LIMIT 50`,
      { now },
    );
    if (!due.length) break;
    for (const job of due) {
      p.run('UPDATE jobs SET locked_until = @until, attempts = attempts + 1 WHERE id = @id', { until: now + 60_000, id: job.id });
      try {
        await handle(deps, job.kind, parseJson<Record<string, unknown>>(job.payload, {}), now);
        p.run('UPDATE jobs SET done_at = @now, locked_until = NULL, last_error = NULL WHERE id = @id', { now, id: job.id });
      } catch (err) {
        const backoff = 60_000 * 2 ** job.attempts;
        p.run('UPDATE jobs SET locked_until = NULL, run_at = @next, last_error = @err WHERE id = @id', { next: now + backoff, err: String(err), id: job.id });
        deps.log?.(`[worker] ${job.kind} failed: ${String(err)}`);
      }
      ran++;
    }
  }
  if (deps.live) await drainOutbox(db, deps.live, now);
  return ran;
}

async function handle(deps: WorkerDeps, kind: string, payload: Record<string, unknown>, now: number) {
  switch (kind) {
    case 'send_post':
      return sendPost(deps, String(payload.postId), now);
    case 'send_deliveries':
      return sendDeliveries(deps, now);
    case 'rollup_day':
      rollup(deps.cfg.db, now, deps.log);
      purgeUnconfirmed(deps.cfg.db, now);
      return;
    default:
      throw new Error(`unknown job ${kind}`);
  }
}

function orgRow(db: Db, orgId: string): OrgRow | undefined {
  return platform(db).get<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = @id`, { id: orgId });
}

// snapshot the audience into deliveries, one row per customer per channel, with a reason when skipped
function sendPost(deps: WorkerDeps, postId: string, now: number) {
  const db = deps.cfg.db;
  const post = platform(db).get<{ id: string; org_id: string; status: string; channels: string; audience: string; sent_at: number | null }>(
    'SELECT id, org_id, status, channels, audience, sent_at FROM posts WHERE id = @id AND deleted_at IS NULL',
    { id: postId },
  );
  if (!post || !['sending', 'scheduled'].includes(post.status)) return;
  const org = orgRow(db, post.org_id)!;
  const t = new Tenant(db, org.id);
  const { topology } = loadTopology(db, org.id);
  const audience = parseJson<Audience>(post.audience, { scopes: [], tags: [], interests: [], locales: [], savedAnyLinked: false, joinedWithinDays: null });
  const channels = parseJson<Channel[]>(post.channels, ['feed']);
  const productIds = t
    .all<{ product_id: string }>('SELECT DISTINCT v.product_id FROM post_products pp JOIN product_variants v ON v.id = pp.variant_id WHERE v.org_id = @org AND pp.post_id = @p', { p: post.id })
    .map((r) => r.product_id);
  const recipients = resolveAudience(db, org, topology, audience, { now, productIds });
  const quiet = inQuietHours(now, org.quiet_hours, org.timezone);
  const sendAfter = quiet ? quietHoursEnd(now, org.quiet_hours, org.timezone) : now;

  db.transaction(() => {
    t.run('DELETE FROM post_scopes WHERE org_id = @org AND post_id = @p', { p: post.id });
    for (const s of audience.scopes) {
      t.run('INSERT OR IGNORE INTO post_scopes (post_id, org_id, scope_type, scope_id) VALUES (@p, @org, @st, @sid)', { p: post.id, st: s.scopeType, sid: s.scopeId });
    }
    const insert = (customerId: string, channel: 'push' | 'email', status: string, reason: string | null, after: number | null) =>
      t.run(
        `INSERT OR IGNORE INTO deliveries (id, org_id, post_id, customer_id, channel, status, skip_reason, send_after, created_at, updated_at)
         VALUES (@id, @org, @p, @c, @ch, @status, @reason, @after, @now, @now)`,
        { id: uuidv7(now), p: post.id, c: customerId, ch: channel, status, reason, after, now },
      );
    for (const r of recipients) {
      if (channels.includes('push')) {
        const ok = canPush(r, org.push_daily_cap);
        if (ok === 'ok') insert(r.customerId, 'push', quiet ? 'held' : 'queued', null, sendAfter);
        else insert(r.customerId, 'push', 'skipped', ok, null);
      }
      if (channels.includes('email')) {
        const ok = canEmail(r);
        insert(r.customerId, 'email', ok === 'ok' ? 'queued' : 'skipped', ok === 'ok' ? null : ok, now);
      }
    }
    t.run(
      "UPDATE posts SET status = 'sent', sent_at = coalesce(sent_at, @now), recipients_count = @n, valid_from = CASE WHEN kind = 'offer' THEN coalesce(valid_from, @now) ELSE valid_from END, updated_at = @now WHERE org_id = @org AND id = @p",
      { now, n: recipients.length, p: post.id },
    );
  })();
  // held pushes go out when quiet hours end
  if (quiet && channels.includes('push')) enqueue(db, 'send_deliveries', {}, sendAfter, `send_deliveries:${sendAfter}`);
  sendDeliveries(deps, now);
}

// sends every queued delivery, and held ones whose quiet hours are over
function sendDeliveries(deps: WorkerDeps, now: number) {
  const db = deps.cfg.db;
  const transport = deps.transport ?? devOutboxTransport(db, deps.log ?? (() => {}));
  topologyCache.clear();
  const rows = platform(db).all<{ id: string; org_id: string; post_id: string | null; alert_id: string | null; customer_id: string; channel: 'push' | 'email' }>(
    `SELECT id, org_id, post_id, alert_id, customer_id, channel FROM deliveries
      WHERE status = 'queued' OR (status = 'held' AND send_after <= @now) ORDER BY created_at LIMIT 1000`,
    { now },
  );
  for (const d of rows) {
    const t = new Tenant(db, d.org_id);
    const org = orgRow(db, d.org_id)!;
    const c = t.get<{ id: string; locale: string; email: string | null; user_id: string | null; name: string | null }>(
      'SELECT id, locale, email, user_id, name FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL',
      { c: d.customer_id },
    );
    if (!c) {
      t.run("UPDATE deliveries SET status = 'skipped', skip_reason = 'erased', updated_at = @now WHERE org_id = @org AND id = @id", { now, id: d.id });
      continue;
    }
    const still = stillAllowed(db, t, d);
    if (still !== 'ok') {
      t.run("UPDATE deliveries SET status = 'skipped', skip_reason = @r, updated_at = @now WHERE org_id = @org AND id = @id", { r: still, now, id: d.id });
      continue;
    }
    const locale = pickLocale(c.locale);
    const tr = translator(locale, 'server');
    let title = '';
    let body = '';
    let payload: Record<string, unknown> = {};
    if (d.post_id) {
      const texts = t.all<{ locale: string; title: string; body: string }>(
        'SELECT tr.locale, tr.title, tr.body FROM post_translations tr JOIN posts p ON p.id = tr.post_id WHERE p.org_id = @org AND tr.post_id = @p',
        { p: d.post_id },
      );
      const def = t.get<{ default_locale: string }>('SELECT default_locale FROM posts WHERE org_id = @org AND id = @p', { p: d.post_id });
      const text = texts.find((x) => x.locale === locale) ?? texts.find((x) => x.locale === def?.default_locale) ?? texts[0];
      const scope = t.get<{ scope_type: string; scope_id: string }>('SELECT scope_type, scope_id FROM post_scopes WHERE org_id = @org AND post_id = @p LIMIT 1', { p: d.post_id });
      const shopName = scope?.scope_type === 'shop' ? t.get<{ name: string }>('SELECT name FROM shops WHERE org_id = @org AND id = @id', { id: scope.scope_id })?.name : null;
      title = d.channel === 'push' ? (shopName ? `${org.name} ${shopName}` : org.name) : text?.title ?? org.name;
      body = d.channel === 'push' ? text?.title ?? '' : text?.body ?? '';
      const cover = t.get<{ storage_key: string | null }>('SELECT f.storage_key FROM posts p LEFT JOIN files f ON f.id = p.cover_file_id WHERE p.org_id = @org AND p.id = @p', { p: d.post_id });
      const sender = senderOf(t, org, scope?.scope_type === 'shop' ? scope.scope_id : null);
      payload = { type: 'post', postId: d.post_id, threadId: org.id, link: `custock://post/${d.post_id}`, image: fileUrl(cover?.storage_key), ...sender };
      if (d.channel === 'email') {
        const token = unsubToken({ customerId: c.id, scopeType: (scope?.scope_type as 'org' | 'group' | 'shop') ?? 'org', scopeId: scope?.scope_id ?? org.id }, unsubKey(deps.cfg));
        const url = `${deps.cfg.publicWebUrl.replace(/\/$/, '')}/unsubscribe/${token}`;
        body = `${body}\n\n${tr('email.footer', { scope: shopName ? `${org.name} ${shopName}` : org.name, unsubscribeUrl: url })}`;
        payload = { ...payload, listUnsubscribe: url, listUnsubscribePost: 'List-Unsubscribe=One-Click' };
      }
    } else if (d.alert_id) {
      const a = t.get<{ variant_id: string; shop_id: string | null; name: string; options: string | null; product_id: string }>(
        `SELECT a.variant_id, a.shop_id, p.name, v.options, p.id AS product_id FROM stock_alerts a
           JOIN product_variants v ON v.id = a.variant_id JOIN products p ON p.id = v.product_id WHERE a.org_id = @org AND a.id = @id`,
        { id: d.alert_id },
      );
      const trName = a ? t.get<{ name: string }>('SELECT tr.name FROM product_translations tr JOIN products p ON p.id = tr.product_id WHERE p.org_id = @org AND tr.product_id = @p AND tr.locale = @l', { p: a.product_id, l: locale })?.name : undefined;
      const product = a ? variantLabel(trName ?? a.name, a.options, locale) : '';
      const shop = a?.shop_id ? t.get<{ name: string }>('SELECT name FROM shops WHERE org_id = @org AND id = @id', { id: a.shop_id })?.name : null;
      const shopLabel = shop ? `${org.name} ${shop}` : org.name;
      const key = d.channel === 'push' ? 'push.backInStock' : 'email.backInStock';
      title = tr(d.channel === 'push' ? `${key}.title` : `${key}.subject`, { shop: shopLabel, product });
      body = tr(`${key}.body`, { shop: shopLabel, product });
      payload = {
        type: 'back_in_stock', variantId: a?.variant_id, productId: a?.product_id, shopId: a?.shop_id, threadId: org.id,
        link: a ? `custock://product/${a.product_id}` : null, ...senderOf(t, org, a?.shop_id ?? null),
      };
    }
    const sent = transport.send({
      channel: d.channel, orgId: org.id, customerId: c.id, userId: c.user_id, to: d.channel === 'email' ? c.email : null,
      locale, title, body, payload,
    });
    t.run("UPDATE deliveries SET status = 'sent', provider_id = @pid, updated_at = @now WHERE org_id = @org AND id = @id", { pid: sent.id, now, id: d.id });
  }
}

// one nightly rollup per org day
function ensureNightly(db: Db, now: number) {
  enqueue(db, 'rollup_day', {}, now, `rollup:${dayKey(now, 'Europe/Athens')}`);
}

// rebuilds daily_shop_stats for the last three days of every org from the ledger
export function rollup(db: Db, now: number, log?: (line: string) => void) {
  const orgs = platform(db).all<OrgRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE archived_at IS NULL`);
  for (const org of orgs) {
    try {
      rollupOrg(db, org, now);
    } catch (err) {
      log?.(`[worker] rollup for ${org.id} failed: ${String(err)}`);
    }
  }
}

function rollupOrg(db: Db, org: OrgRow, now: number) {
  {
    const t = new Tenant(db, org.id);
    const since = localDayStart(now - 2 * DAY, org.timezone);
    const moves = t.all<{ shop_id: string; kind: string; qty_delta: number; uom: string; price: number | null; cost: number | null; recorded_at: number }>(
      `SELECT m.shop_id, m.kind, m.qty_delta, p.uom, coalesce(m.unit_price_minor, v.price_minor) AS price, coalesce(m.unit_cost_minor, v.cost_minor) AS cost, m.recorded_at
         FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
        WHERE m.org_id = @org AND m.recorded_at >= @since`,
      { since },
    );
    const rows = new Map<string, Record<string, number | string>>();
    const row = (shop: string, day: string) => {
      const k = `${shop}|${day}`;
      let r = rows.get(k);
      if (!r) {
        r = { shop_id: shop, day, sales_qty: 0, sales_value_minor: 0, returns_qty: 0, received_qty: 0, received_cost_minor: 0, shrink_qty: 0, shrink_cost_minor: 0, new_customers: 0, unsubscribes: 0, posts_sent: 0 };
        rows.set(k, r);
      }
      return r as Record<string, number>;
    };
    for (const m of moves) {
      const r = row(m.shop_id, dayKey(m.recorded_at, org.timezone));
      const units = m.uom === 'piece' ? m.qty_delta : m.qty_delta / 1000;
      if (m.kind === 'sale') { r.sales_qty! += -m.qty_delta; r.sales_value_minor! += Math.round(-units * (m.price ?? 0)); }
      if (m.kind === 'return') r.returns_qty! += m.qty_delta;
      if (m.kind === 'receive') { r.received_qty! += m.qty_delta; r.received_cost_minor! += Math.round(units * (m.cost ?? 0)); }
      if (m.kind === 'damage' || ((m.kind === 'adjust' || m.kind === 'count') && m.qty_delta < 0)) { r.shrink_qty! += -m.qty_delta; r.shrink_cost_minor! += Math.round(-units * (m.cost ?? 0)); }
    }
    db.transaction(() => {
      for (const r of rows.values()) {
        t.run(
          `INSERT INTO daily_shop_stats (org_id, shop_id, day, sales_qty, sales_value_minor, returns_qty, received_qty, received_cost_minor, shrink_qty, shrink_cost_minor, new_customers, unsubscribes, posts_sent)
           VALUES (@org, @shop_id, @day, @sales_qty, @sales_value_minor, @returns_qty, @received_qty, @received_cost_minor, @shrink_qty, @shrink_cost_minor, 0, 0, 0)
           ON CONFLICT (shop_id, day) DO UPDATE SET sales_qty = excluded.sales_qty, sales_value_minor = excluded.sales_value_minor,
             returns_qty = excluded.returns_qty, received_qty = excluded.received_qty, received_cost_minor = excluded.received_cost_minor,
             shrink_qty = excluded.shrink_qty, shrink_cost_minor = excluded.shrink_cost_minor`,
          r,
        );
      }
    })();
  }
}

// starts the loop in the server process
export function startWorker(deps: WorkerDeps, everyMs = 5_000): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runJobs(deps)
      .catch((err) => deps.log?.(`[worker] ${String(err)}`))
      .finally(() => {
        busy = false;
      });
  }, everyMs);
  return () => clearInterval(timer);
}

const topologyCache = new Map<string, ReturnType<typeof loadTopology>['topology']>();

// a delivery may only go out if the customer still allows it and still follows a shop the post reaches
function stillAllowed(db: Db, t: Tenant, d: { post_id: string | null; alert_id: string | null; customer_id: string; channel: 'push' | 'email' }): string {
  const c = t.get<{ email: string | null; email_ok: number; email_verified_at: number | null; push_ok: number; user_id: string | null }>(
    'SELECT email, email_ok, email_verified_at, push_ok, user_id FROM customers WHERE org_id = @org AND id = @c AND erased_at IS NULL',
    { c: d.customer_id },
  );
  if (!c) return 'erased';
  const suppressed = c.email ? !!platform(db).get('SELECT 1 FROM email_suppressions WHERE email = @e', { e: c.email }) : false;
  if (d.alert_id) {
    // notify me was asked for this one product: an address or a device is enough
    if (d.channel === 'email' && (!c.email || !c.email_verified_at || suppressed)) return 'no_consent';
    return 'ok';
  }
  if (d.channel === 'push' && !c.push_ok) return 'no_consent';
  if (d.channel === 'email' && (!c.email_ok || !c.email_verified_at)) return 'no_consent';
  if (d.channel === 'email' && suppressed) return 'suppressed';
  if (d.post_id) {
    const post = t.get<{ status: string }>('SELECT status FROM posts WHERE org_id = @org AND id = @p AND deleted_at IS NULL', { p: d.post_id });
    if (!post || post.status === 'cancelled') return 'cancelled';
    const topology = topologyCache.get(t.orgId) ?? loadTopology(db, t.orgId).topology;
    topologyCache.set(t.orgId, topology);
    const scopes = t.all<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string }>('SELECT scope_type, scope_id FROM post_scopes WHERE org_id = @org AND post_id = @p', { p: d.post_id });
    const shops = new Set(scopes.flatMap((x) => shopsInScope(topology, { scopeType: x.scope_type, scopeId: x.scope_id })));
    const subs = t.all<{ scope_type: 'org' | 'group' | 'shop'; scope_id: string; status: 'pending' | 'subscribed' | 'unsubscribed' }>(
      'SELECT scope_type, scope_id, status FROM customer_subscriptions WHERE org_id = @org AND customer_id = @c',
      { c: d.customer_id },
    );
    const follows = [...shops].some((shop) => followsShop(subs.map((x) => ({ scopeType: x.scope_type, scopeId: x.scope_id, status: x.status })), topology, shop));
    if (!follows) return 'unsubscribed';
  }
  return 'ok';
}

// unconfirmed signups are erased after 30 days (thinking/06)
export function purgeUnconfirmed(db: Db, now: number) {
  const old = platform(db).all<{ id: string; org_id: string; email: string | null }>(
    `SELECT c.id, c.org_id, c.email FROM customers c
      WHERE c.erased_at IS NULL AND c.email_verified_at IS NULL AND c.user_id IS NULL AND c.created_at < @cut
        AND NOT EXISTS (SELECT 1 FROM customer_subscriptions s WHERE s.customer_id = c.id AND s.status = 'subscribed')`,
    { cut: now - 30 * DAY },
  );
  for (const r of old) {
    const t = new Tenant(db, r.org_id);
    db.transaction(() => {
      t.run(
        `UPDATE customers SET name = NULL, email = NULL, phone = NULL, birthday = NULL, search_key = NULL, contact_key = NULL,
           email_ok = 0, push_ok = 0, sms_ok = 0, erased_at = @now, updated_at = @now WHERE org_id = @org AND id = @c`,
        { now, c: r.id },
      );
      t.run("UPDATE customer_subscriptions SET status = 'unsubscribed', updated_at = @now WHERE org_id = @org AND customer_id = @c", { now, c: r.id });
      t.run('DELETE FROM join_confirmations WHERE org_id = @org AND customer_id = @c', { c: r.id });
      t.run('UPDATE consents SET ip = NULL, user_agent = NULL WHERE org_id = @org AND customer_id = @c', { c: r.id });
      platform(db).run('DELETE FROM dev_outbox WHERE customer_id = @c', { c: r.id });
    })();
  }
  return old.length;
}

// emails go out as "<shop> via Custock" and replies reach the shop
function senderOf(t: Tenant, org: OrgRow, shopId: string | null): { fromName: string; replyTo: string | null } {
  const shop = shopId
    ? t.get<{ name: string; email: string | null }>('SELECT name, email FROM shops WHERE org_id = @org AND id = @id', { id: shopId })
    : t.get<{ name: string; email: string | null }>('SELECT name, email FROM shops WHERE org_id = @org AND email IS NOT NULL AND archived_at IS NULL ORDER BY created_at LIMIT 1');
  const label = shopId && shop ? `${org.name} ${shop.name}` : org.name;
  return { fromName: `${label} via Custock`, replyTo: shop?.email ?? null };
}
