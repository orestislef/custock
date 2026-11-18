// posts: create, edit with etags, audience preview, publish or submit for approval, approve, cancel, delete

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { Audience, effectiveAtScope, PostInput, uuidv7, type Post } from '@custock/core';
import type { AppEnv } from '../types';
import { audit, nextStamp } from '../lib/audit';
import { cfgOf, need, nowOf, orgOf } from '../lib/context';
import { idempotent } from '../lib/idempotency';
import { notifyMembers, notifyUser } from '../lib/notify';
import { ApiProblem, forbidden, notFound } from '../lib/problem';
import { parseJson, platform } from '../lib/tenant';
import { previewAudience } from '../services/audience';
import { loadPosts } from '../services/posts';
import { setFileBase, uploadKeyFromUrl } from '../services/catalog';
import { confirmFiles } from '../lib/files';
import { enqueue } from '../worker';
import { policyIn } from '../lib/policy';

export const postEtag = (updatedAt: number) => `W/"post-${updatedAt}"`;

type Scope = { scopeType: 'org' | 'group' | 'shop'; scopeId: string };

// every scope of the audience must be one where the member holds perm
function allowedAt(c: Context<AppEnv>, scopes: Scope[], perm: string): boolean {
  const { assignments, topology } = orgOf(c);
  return scopes.length > 0 && scopes.every((s) => effectiveAtScope(assignments, topology, s).perms.has(perm));
}

function checkScopes(c: Context<AppEnv>, scopes: Scope[]) {
  const { topology, org } = orgOf(c);
  for (const s of scopes) {
    const known = s.scopeType === 'org' ? s.scopeId === org.id : s.scopeType === 'group' ? Object.hasOwn(topology.groups, s.scopeId) : topology.shops.includes(s.scopeId);
    if (!known) throw notFound('scope');
  }
}

function checkInput(c: Context<AppEnv>, input: PostInput) {
  const { t } = orgOf(c);
  checkScopes(c, input.audience.scopes);
  if (!allowedAt(c, input.audience.scopes, 'posts.create')) throw forbidden('posts.create at every scope', 'scope');
  if (input.channels.includes('push') && !allowedAt(c, input.audience.scopes, 'posts.channel.push')) throw forbidden('posts.channel.push');
  if (input.channels.includes('email') && !allowedAt(c, input.audience.scopes, 'posts.channel.email')) throw forbidden('posts.channel.email');
  if (input.products.some((p) => p.offerPriceMinor != null) && !allowedAt(c, input.audience.scopes, 'offers.price.set')) throw forbidden('offers.price.set');
  for (const p of input.products) if (!t.get('SELECT 1 FROM product_variants WHERE org_id = @org AND id = @v', { v: p.variantId })) throw notFound('variant');
  if (!input.translations[input.defaultLocale]) throw new ApiProblem(400, 'validation', 'default language text missing', { [`translations.${input.defaultLocale}`]: 'required' });
}

function writeChildren(c: Context<AppEnv>, postId: string, input: PostInput, now: number) {
  const { t } = orgOf(c);
  t.run('DELETE FROM post_translations WHERE post_id = @p AND post_id IN (SELECT id FROM posts WHERE org_id = @org)', { p: postId });
  for (const [locale, text] of Object.entries(input.translations)) {
    if (text) t.run('INSERT INTO post_translations (post_id, locale, title, body) SELECT @p, @l, @title, @body WHERE EXISTS (SELECT 1 FROM posts WHERE id = @p AND org_id = @org)', { p: postId, l: locale, title: text.title, body: text.body });
  }
  t.run('DELETE FROM post_products WHERE post_id = @p AND post_id IN (SELECT id FROM posts WHERE org_id = @org)', { p: postId });
  input.products.forEach((p, i) =>
    t.run('INSERT INTO post_products (post_id, variant_id, offer_price_minor, sort) SELECT @p, @v, @offer, @i WHERE EXISTS (SELECT 1 FROM posts WHERE id = @p AND org_id = @org)', { p: postId, v: p.variantId, offer: p.offerPriceMinor, i }),
  );
  let coverId: string | null = null;
  if (input.coverUrl) {
    // like product photos: one of this business's own uploads, or an https picture somewhere else.
    // a bare storage key or another business's upload is refused, so deleting a business can never
    // take a photo that belongs to someone else
    const { org } = orgOf(c);
    setFileBase(cfgOf(c).apiPublicUrl);
    const key = uploadKeyFromUrl(input.coverUrl);
    if (key) {
      const own = key.startsWith(`uploads/${org.id}/`) || key.startsWith(`orgs/${org.id}/`);
      coverId = own ? t.get<{ id: string }>('SELECT id FROM files WHERE org_id = @org AND storage_key = @k AND deleted_at IS NULL', { k: key })?.id ?? null : null;
      if (!coverId) throw new ApiProblem(400, 'validation', 'unknown upload', { coverUrl: 'not_found' });
      confirmFiles(cfgOf(c).db, [coverId], now);
    } else {
      if (!/^https:\/\/[^\s]+$/.test(input.coverUrl)) throw new ApiProblem(400, 'validation', 'the cover must be https', { coverUrl: 'https' });
      coverId = t.get<{ id: string }>('SELECT id FROM files WHERE org_id = @org AND storage_key = @k', { k: input.coverUrl })?.id ?? null;
      if (!coverId) {
        coverId = uuidv7(now);
        t.run("INSERT INTO files (id, org_id, storage_key, purpose, is_public, mime, bytes, created_by, created_at, confirmed_at) VALUES (@id, @org, @k, 'post', 1, 'image/jpeg', 0, @u, @now, @now)", { id: coverId, k: input.coverUrl, u: c.get('user').id, now });
      }
    }
  }
  return coverId;
}

function postRow(c: Context<AppEnv>, id: string) {
  const row = orgOf(c).t.get<{ id: string; status: Post['status']; author_id: string; audience: string; updated_at: number; scheduled_at: number | null; kind: string; valid_from: number | null; valid_until: number | null }>(
    'SELECT id, status, author_id, audience, updated_at, scheduled_at, kind, valid_from, valid_until FROM posts WHERE org_id = @org AND id = @id AND deleted_at IS NULL',
    { id },
  );
  if (!row) throw notFound('post');
  return row;
}

const one = (c: Context<AppEnv>, id: string) => loadPosts(orgOf(c).t, [id], { withStats: true, showPrices: true })[0]!;

// goes out now or at its time. offers get their price history rows here.
function release(c: Context<AppEnv>, id: string, approvedBy: string | null, from: Post['status'][]) {
  const { t } = orgOf(c);
  const now = nowOf(c);
  const row = postRow(c, id);
  const scheduled = row.scheduled_at != null && row.scheduled_at > now;
  // how many posts a person sends in a day (policy posts.dailyLimit, 0 means no limit)
  const most = Number(policyIn(cfgOf(c).db, orgOf(c).org.id, 'posts.dailyLimit', { userId: c.get('user').id }));
  if (most > 0) {
    const sent = t.get<{ n: number }>(
      "SELECT count(*) AS n FROM audit_log WHERE org_id = @org AND actor_id = @me AND action IN ('post.published', 'post.scheduled') AND created_at > @since",
      { me: c.get('user').id, since: now - 86_400_000 },
    )!.n;
    if (sent >= most) throw new ApiProblem(403, 'limit_reached', 'posts for today');
  }
  cfgOf(c).db.transaction(() => {
    const moved = t.run(
      `UPDATE posts SET status = @status, approved_by = coalesce(@approver, approved_by, @me), updated_at = @stamp
        WHERE org_id = @org AND id = @id AND status IN (SELECT value FROM json_each(@from))`,
      { status: scheduled ? 'scheduled' : 'sending', approver: approvedBy, me: c.get('user').id, stamp: nextStamp(row.updated_at, now), id, from },
    );
    if (!moved.changes) throw new ApiProblem(409, 'conflict', 'post changed status');
    if (row.kind === 'offer') {
      const from = row.valid_from ?? row.scheduled_at ?? now;
      const offers = t.all<{ variant_id: string; offer_price_minor: number }>('SELECT pp.variant_id, pp.offer_price_minor FROM post_products pp JOIN posts p ON p.id = pp.post_id WHERE p.org_id = @org AND pp.post_id = @id AND pp.offer_price_minor IS NOT NULL', { id });
      for (const o of offers) {
        t.run(
          "INSERT INTO price_history (id, org_id, variant_id, shop_id, price_minor, source, post_id, valid_from, valid_to, changed_by) VALUES (@hid, @org, @v, NULL, @p, 'offer', @post, @from, @to, @u)",
          { hid: uuidv7(now), v: o.variant_id, p: o.offer_price_minor, post: id, from, to: row.valid_until, u: c.get('user').id },
        );
      }
    }
    enqueue(cfgOf(c).db, 'send_post', { postId: id }, scheduled ? row.scheduled_at! : now, `send_post:${id}`);
    audit(t, { id: c.get('user').id }, scheduled ? 'post.scheduled' : 'post.published', { type: 'post', id }, null, null, now);
  })();
}

export function postWriteRoutes(app: Hono<AppEnv>) {
  app.post('/v1/orgs/:org/posts', async (c) => {
    need(c, 'posts.create');
    const input = PostInput.parse(await c.req.json());
    checkInput(c, input);
    return idempotent(c, () => {
      const { t } = orgOf(c);
      const now = nowOf(c);
      const id = uuidv7(now);
      cfgOf(c).db.transaction(() => {
        t.run(
          `INSERT INTO posts (id, org_id, kind, status, default_locale, channels, audience, scheduled_at, valid_from, valid_until, author_id, created_at, updated_at)
           VALUES (@id, @org, @kind, 'draft', @locale, @channels, @audience, @sched, @from, @until, @u, @now, @now)`,
          {
            id, kind: input.kind, locale: input.defaultLocale, channels: JSON.stringify(input.channels), audience: JSON.stringify(input.audience),
            sched: input.scheduledAt, from: input.validFrom, until: input.validUntil, u: c.get('user').id, now,
          },
        );
        const cover = writeChildren(c, id, input, now);
        if (cover) t.run('UPDATE posts SET cover_file_id = @f WHERE org_id = @org AND id = @id', { f: cover, id });
      })();
      c.header('ETag', postEtag(now));
      return { status: 201, body: one(c, id) };
    });
  });

  // drafts by their author or a publisher. a sent post only takes text and cover, nothing is resent.
  app.patch('/v1/orgs/:org/posts/:id', async (c) => {
    need(c, 'posts.create');
    const id = c.req.param('id');
    const row = postRow(c, id);
    const etag = postEtag(row.updated_at);
    const want = c.req.header('If-Match');
    if (want && want !== etag && want !== '*') throw new ApiProblem(412, 'conflict', 'changed since you loaded it');
    const input = PostInput.parse(await c.req.json());
    const scopes = parseJson<Audience>(row.audience, { scopes: [] } as unknown as Audience).scopes;
    const publisher = allowedAt(c, scopes, 'posts.publish');
    if (row.author_id !== c.get('user').id && !publisher) throw forbidden('not your post');
    if (row.status === 'cancelled' || row.status === 'failed') throw new ApiProblem(409, 'conflict', 'post is closed');
    const { t } = orgOf(c);
    const now = nextStamp(row.updated_at, nowOf(c));
    if (row.status === 'sent' || row.status === 'sending') {
      // what went out was approved as it was: changing it afterwards needs the right to publish
      if (!publisher) throw forbidden('posts.publish');
      cfgOf(c).db.transaction(() => {
        t.run('DELETE FROM post_translations WHERE post_id = @p AND post_id IN (SELECT id FROM posts WHERE org_id = @org)', { p: id });
        for (const [locale, text] of Object.entries(input.translations)) {
          if (text) t.run('INSERT INTO post_translations (post_id, locale, title, body) SELECT @p, @l, @title, @body WHERE EXISTS (SELECT 1 FROM posts WHERE id = @p AND org_id = @org)', { p: id, l: locale, title: text.title, body: text.body });
        }
        t.run('UPDATE posts SET updated_at = @now WHERE org_id = @org AND id = @id', { now, id });
        audit(t, { id: c.get('user').id }, 'post.edited_after_send', { type: 'post', id }, null, null, now);
      })();
    } else {
      checkInput(c, input);
      const publisherNew = allowedAt(c, input.audience.scopes, 'posts.publish');
      cfgOf(c).db.transaction(() => {
        const cover = writeChildren(c, id, input, now);
        t.run(
          `UPDATE posts SET kind = @kind, default_locale = @locale, channels = @channels, audience = @audience, scheduled_at = @sched,
             valid_from = @from, valid_until = @until, cover_file_id = @cover, updated_at = @now,
             status = CASE WHEN status = 'scheduled' AND NOT @publisher THEN 'pending_approval' ELSE status END,
             approved_by = CASE WHEN status = 'scheduled' AND NOT @publisher THEN NULL ELSE approved_by END
           WHERE org_id = @org AND id = @id`,
          {
            kind: input.kind, locale: input.defaultLocale, channels: JSON.stringify(input.channels), audience: JSON.stringify(input.audience),
            sched: input.scheduledAt, from: input.validFrom, until: input.validUntil, cover, now, publisher: publisherNew, id,
          },
        );
        if (row.status === 'scheduled' && !publisherNew) {
          // approved, not sent yet, and changed by someone who cannot publish: it waits for approval
          // again and the scheduled send goes away until someone approves the new text
          platform(cfgOf(c).db).run("UPDATE jobs SET done_at = @now, last_error = 'waiting for approval again' WHERE dedupe_key = @k AND done_at IS NULL", { now, k: `send_post:${id}` });
        } else if (row.status === 'scheduled' && input.scheduledAt) {
          platform(cfgOf(c).db).run("UPDATE jobs SET run_at = @at WHERE dedupe_key = @k AND done_at IS NULL AND kind = 'send_post'", { at: input.scheduledAt, k: `send_post:${id}` });
        }
      })();
    }
    if (row.status === 'scheduled' && !allowedAt(c, input.audience.scopes, 'posts.publish')) {
      const post = one(c, id);
      notifyMembers(cfgOf(c).db, orgOf(c).org.id, {
        // whoever can approve it: publish rights at every place the post reaches, shop managers included
        perm: 'posts.publish', scopes: input.audience.scopes, key: 'approvalNeeded', exceptUserId: c.get('user').id,
        params: () => ({ author: c.get('user').displayName ?? '', title: post.translations[post.defaultLocale]?.title ?? '' }), payload: { postId: id },
      });
      audit(orgOf(c).t, { id: c.get('user').id }, 'post.submitted', { type: 'post', id }, null, null, now);
    }
    c.header('ETag', postEtag(now));
    return c.json(one(c, id));
  });

  app.delete('/v1/orgs/:org/posts/:id', (c) => {
    need(c, 'posts.delete');
    const id = c.req.param('id');
    const doomed = postRow(c, id);
    const deleteScopes = parseJson<Audience>(doomed.audience, { scopes: [] } as unknown as Audience).scopes;
    if (!allowedAt(c, deleteScopes, 'posts.delete')) throw forbidden('posts.delete at every scope', 'scope');
    const { t } = orgOf(c);
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      t.run('UPDATE posts SET deleted_at = @now, updated_at = @now WHERE org_id = @org AND id = @id', { now, id });
      t.run("UPDATE price_history SET valid_to = @now WHERE org_id = @org AND post_id = @id AND source = 'offer' AND (valid_to IS NULL OR valid_to > @now)", { now, id });
      platform(cfgOf(c).db).run("UPDATE jobs SET done_at = @now, last_error = 'post deleted' WHERE dedupe_key = @k AND done_at IS NULL", { now, k: `send_post:${id}` });
      audit(t, { id: c.get('user').id }, 'post.deleted', { type: 'post', id }, null, null, now);
    })();
    return c.body(null, 204);
  });

  app.post('/v1/orgs/:org/posts/audience-preview', async (c) => {
    need(c, 'posts.create');
    const body = z.object({ audience: Audience, channels: z.array(z.string()).default(['feed']), productIds: z.array(z.string()).optional() }).parse(await c.req.json());
    const { org, topology, shopNames, groupNames } = orgOf(c);
    checkScopes(c, body.audience.scopes);
    if (!allowedAt(c, body.audience.scopes, 'posts.create')) throw forbidden('posts.create at every scope', 'scope');
    return c.json(
      previewAudience(cfgOf(c).db, org, topology, body.audience, body.channels, {
        now: nowOf(c),
        productIds: body.productIds,
        scopeName: (type, id) => (type === 'org' ? org.name : type === 'group' ? groupNames[id] ?? id : shopNames[id] ?? id),
      }),
    );
  });

  // publish when allowed at every scope, otherwise it waits for approval
  app.post('/v1/orgs/:org/posts/:id/publish', (c) => {
    need(c, 'posts.create');
    const id = c.req.param('id');
    const row = postRow(c, id);
    if (!['draft', 'pending_approval'].includes(row.status)) throw new ApiProblem(409, 'conflict', `post is ${row.status}`);
    const scopes = parseJson<Audience>(row.audience, { scopes: [] } as unknown as Audience).scopes;
    if (allowedAt(c, scopes, 'posts.publish')) {
      release(c, id, row.status === 'pending_approval' ? c.get('user').id : null, ['draft', 'pending_approval']);
    } else {
      if (row.author_id !== c.get('user').id) throw forbidden('not your post');
      const { t, org } = orgOf(c);
      const now = nowOf(c);
      const moved = t.run("UPDATE posts SET status = 'pending_approval', updated_at = @now WHERE org_id = @org AND id = @id AND status IN ('draft', 'pending_approval')", { now: nextStamp(row.updated_at, now), id });
      if (!moved.changes) throw new ApiProblem(409, 'conflict', 'post changed status');
      const post = one(c, id);
      const title = post.translations[post.defaultLocale]?.title ?? '';
      notifyMembers(cfgOf(c).db, org.id, {
        perm: 'posts.publish', scopes, key: 'approvalNeeded', exceptUserId: c.get('user').id,
        params: () => ({ author: c.get('user').displayName ?? '', title }), payload: { postId: id },
      });
      audit(t, { id: c.get('user').id }, 'post.submitted', { type: 'post', id }, null, null, now);
    }
    return c.json(one(c, id));
  });

  app.post('/v1/orgs/:org/posts/:id/approve', (c) => {
    need(c, 'posts.publish');
    const id = c.req.param('id');
    const row = postRow(c, id);
    if (row.status !== 'pending_approval') throw new ApiProblem(409, 'conflict', `post is ${row.status}`);
    const scopes = parseJson<Audience>(row.audience, { scopes: [] } as unknown as Audience).scopes;
    if (!allowedAt(c, scopes, 'posts.publish')) throw forbidden('posts.publish at every scope', 'scope');
    release(c, id, c.get('user').id, ['pending_approval']);
    const done = one(c, id);
    // the author hears it went out (or is set for its time), unless they approved it themselves
    if (row.author_id !== c.get('user').id) {
      notifyUser(cfgOf(c).db, orgOf(c).org.id, row.author_id, {
        key: done.status === 'scheduled' ? 'postScheduled' : 'postPublished',
        params: () => ({ title: done.translations[done.defaultLocale]?.title ?? '' }), payload: { postId: id },
      });
    }
    return c.json(done);
  });

  // stops what has not gone out yet. sent pushes and emails cannot be pulled back.
  app.post('/v1/orgs/:org/posts/:id/cancel', (c) => {
    need(c, 'posts.publish');
    const id = c.req.param('id');
    const row = postRow(c, id);
    if (!['scheduled', 'sending', 'pending_approval', 'draft'].includes(row.status)) throw new ApiProblem(409, 'conflict', `post is ${row.status}`);
    const cancelScopes = parseJson<Audience>(row.audience, { scopes: [] } as unknown as Audience).scopes;
    if (!allowedAt(c, cancelScopes, 'posts.publish')) throw forbidden('posts.publish at every scope', 'scope');
    const { t } = orgOf(c);
    const now = nowOf(c);
    cfgOf(c).db.transaction(() => {
      const moved = t.run(
        "UPDATE posts SET status = 'cancelled', updated_at = @stamp WHERE org_id = @org AND id = @id AND status IN ('scheduled', 'sending', 'pending_approval', 'draft')",
        { stamp: nextStamp(row.updated_at, now), id },
      );
      if (!moved.changes) throw new ApiProblem(409, 'conflict', 'post changed status');
      t.run("UPDATE deliveries SET status = 'skipped', skip_reason = 'cancelled', updated_at = @now WHERE org_id = @org AND post_id = @id AND status IN ('queued', 'held')", { now, id });
      platform(cfgOf(c).db).run("UPDATE jobs SET done_at = @now, last_error = 'cancelled' WHERE dedupe_key = @k AND done_at IS NULL", { now, k: `send_post:${id}` });
      t.run("UPDATE price_history SET valid_to = @now WHERE org_id = @org AND post_id = @id AND source = 'offer' AND (valid_to IS NULL OR valid_to > @now)", { now, id });
      audit(t, { id: c.get('user').id }, 'post.cancelled', { type: 'post', id }, null, null, now);
    })();
    const stopped = one(c, id);
    // a post waiting for approval that someone else stopped: its author hears it will not go out
    if (row.status === 'pending_approval' && row.author_id !== c.get('user').id) {
      notifyUser(cfgOf(c).db, orgOf(c).org.id, row.author_id, {
        key: 'postReturned', params: () => ({ title: stopped.translations[stopped.defaultLocale]?.title ?? '' }), payload: { postId: id },
      });
    }
    return c.json(stopped);
  });
}
