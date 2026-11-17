// posts (read side)

import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types';
import { need, orgOf, orgWide, readerLocale, shopsFor } from '../lib/context';
import { notFound } from '../lib/problem';
import { clampLimit, decodeCursor, page } from '../lib/tenant';
import { loadPosts, postShops } from '../services/posts';

export function postRoutes(app: Hono<AppEnv>) {
  // shop scoped members see posts that reach their shops, plus their own
  function visibleIds(c: Context<AppEnv>, status?: string): string[] {
    const { t, topology } = orgOf(c);
    const all = orgWide(c, 'posts.view');
    const mine = new Set(shopsFor(c, 'posts.view'));
    const me = c.get('user').id;
    const rows = t.all<{ id: string; author_id: string }>(
      `SELECT id, author_id FROM posts WHERE org_id = @org AND deleted_at IS NULL AND (@status IS NULL OR status = @status)
        ORDER BY coalesce(sent_at, scheduled_at, created_at) DESC`,
      { status: status ?? null },
    );
    if (all) return rows.map((r) => r.id);
    const posts = loadPosts(t, rows.map((r) => r.id), { withStats: false, showPrices: false });
    return posts.filter((p) => p.authorId === me || postShops(t, p, topology).some((s) => mine.has(s))).map((p) => p.id);
  }

  app.get('/v1/orgs/:org/posts', (c) => {
    need(c, 'posts.view');
    const { t } = orgOf(c);
    const q = c.req.query();
    const limit = clampLimit(q.limit);
    const offset = decodeCursor(q.cursor);
    const ids = visibleIds(c, q.status).slice(offset, offset + limit + 1);
    return c.json(page(loadPosts(t, ids, { withStats: true, showPrices: true, locale: readerLocale(c, orgOf(c).org.default_locale) }), offset, limit));
  });

  app.get('/v1/orgs/:org/posts/:id', (c) => {
    need(c, 'posts.view');
    const id = c.req.param('id');
    if (!visibleIds(c).includes(id)) throw notFound('post');
    const [post] = loadPosts(orgOf(c).t, [id], { withStats: true, showPrices: true, locale: readerLocale(c, orgOf(c).org.default_locale) });
    if (!post) throw notFound('post');
    const stamp = orgOf(c).t.get<{ updated_at: number }>('SELECT updated_at FROM posts WHERE org_id = @org AND id = @id', { id });
    if (stamp) c.header('ETag', `W/"post-${stamp.updated_at}"`);
    return c.json(post);
  });
}
