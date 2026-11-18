// errors seen in production. browsers report their own errors at /v1/client-errors (no login,
// rate limited, a strict and small body, no personal data). super admins read and triage issues
// under /v1/platform/errors.

import type { Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ClientErrorInput, IssueKind, IssueStatus, type Issue, type IssueCounts, type IssueDetail, type IssueExample } from '@custock/core';
import type { Db } from '@custock/db';
import type { AppEnv } from '../types';
import { cfgOf, nowOf, requireAuth } from '../lib/context';
import { ApiProblem, forbidden, notFound } from '../lib/problem';
import { rateLimit } from '../lib/ratelimit';
import { parseJson, platform } from '../lib/tenant';
import { isSuperadmin } from '../lib/platform-access';
import { captureError } from '../lib/errors';

const PAGE = 50;

const superOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isSuperadmin(cfgOf(c).db, c.get('user').id)) throw forbidden('super admins only');
  await next();
};

interface IssueRow {
  id: string;
  kind: Issue['kind'];
  title: string;
  route: string | null;
  frame: string | null;
  status: Issue['status'];
  count: number;
  first_seen: number;
  last_seen: number;
  resolved_at: number | null;
  example: string;
}

const COLS = 'id, kind, title, route, frame, status, count, first_seen, last_seen, resolved_at, example';

const issueOf = (r: IssueRow): Issue => ({
  id: r.id, kind: r.kind, title: r.title, route: r.route, frame: r.frame, status: r.status, count: r.count,
  firstSeen: r.first_seen, lastSeen: r.last_seen, resolvedAt: r.resolved_at,
});

export function issueCounts(db: Db): IssueCounts {
  const rows = platform(db).all<{ status: Issue['status']; n: number }>('SELECT status, count(*) AS n FROM error_events GROUP BY status');
  const n = (s: Issue['status']) => rows.find((r) => r.status === s)?.n ?? 0;
  return { open: n('open'), resolved: n('resolved'), ignored: n('ignored') };
}

export function listIssues(db: Db, q: { status?: string; kind?: string; q?: string; cursor?: string }) {
  const status = q.status && q.status !== 'all' ? IssueStatus.parse(q.status) : null;
  const kind = q.kind ? IssueKind.parse(q.kind) : null;
  const needle = q.q?.trim().slice(0, 100) || null;
  const offset = q.cursor && /^\d{1,6}$/.test(q.cursor) ? Number(q.cursor) : 0;
  const rows = platform(db).all<IssueRow>(
    `SELECT ${COLS} FROM error_events
      WHERE (@status IS NULL OR status = @status) AND (@kind IS NULL OR kind = @kind)
        AND (@q IS NULL OR instr(lower(title), lower(@q)) > 0 OR instr(lower(coalesce(route, '')), lower(@q)) > 0 OR instr(lower(coalesce(frame, '')), lower(@q)) > 0)
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END, last_seen DESC
      LIMIT @lim OFFSET @off`,
    { status, kind, q: needle, lim: PAGE + 1, off: offset },
  );
  const more = rows.length > PAGE;
  return {
    items: rows.slice(0, PAGE).map(issueOf),
    nextCursor: more ? String(offset + PAGE) : null,
    counts: issueCounts(db),
  };
}

export function issueDetail(db: Db, id: string): IssueDetail {
  const r = platform(db).get<IssueRow>(`SELECT ${COLS} FROM error_events WHERE id = @id`, { id });
  if (!r) throw notFound('no such error');
  const ex = parseJson<Partial<IssueExample>>(r.example, {});
  const example: IssueExample = {
    at: ex.at ?? r.last_seen, message: ex.message ?? r.title, stack: ex.stack ?? null, method: ex.method ?? null, route: ex.route ?? r.route,
    status: ex.status ?? null, release: ex.release ?? null, userId: ex.userId ?? null, orgId: ex.orgId ?? null,
    browser: ex.browser ?? null, os: ex.os ?? null, build: ex.build ?? null, requestId: ex.requestId ?? null,
  };
  const orgName = example.orgId
    ? platform(db).get<{ name: string }>('SELECT name FROM organizations WHERE id = @id', { id: example.orgId })?.name ?? null
    : null;
  return { ...issueOf(r), example, orgName };
}

export function setIssueStatus(db: Db, id: string, status: Issue['status'], now: number): Issue {
  const p = platform(db);
  const res = p.run('UPDATE error_events SET status = @s, resolved_at = CASE WHEN @s = \'resolved\' THEN @now ELSE NULL END WHERE id = @id', { s: status, now, id });
  if (!res.changes) throw notFound('no such error');
  return issueOf(p.get<IssueRow>(`SELECT ${COLS} FROM error_events WHERE id = @id`, { id })!);
}

export function errorRoutes(app: Hono<AppEnv>) {
  // a browser's own error: small, strict, and never more than a few a minute from one address
  app.post(
    '/v1/client-errors',
    rateLimit({ windowMs: 60_000, max: 20, prefix: 'client-errors' }),
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json(new ApiProblem(413 as 400, 'validation', 'body too large').toJSON(), 413) }),
    async (c) => {
      const input = ClientErrorInput.parse(await c.req.json());
      const api = input.source === 'api';
      captureError(
        cfgOf(c).db,
        {
          kind: 'client',
          message: api ? `HTTP ${input.status ?? 500} on ${input.method ?? 'GET'} ${input.apiPath ?? input.path}` : input.message,
          stack: api ? null : input.stack ?? null,
          route: api ? input.apiPath ?? input.path : input.path,
          method: api ? input.method ?? null : null,
          status: api ? input.status ?? null : null,
          browser: input.browser,
          os: input.os,
          build: input.build || null,
        },
        { now: nowOf(c) },
      );
      return c.body(null, 204);
    },
  );

  app.get('/v1/platform/errors', requireAuth, superOnly, (c) =>
    c.json(listIssues(cfgOf(c).db, { status: c.req.query('status'), kind: c.req.query('kind'), q: c.req.query('q'), cursor: c.req.query('cursor') })),
  );
  app.get('/v1/platform/errors/:id', requireAuth, superOnly, (c) => c.json(issueDetail(cfgOf(c).db, c.req.param('id'))));
  app.patch('/v1/platform/errors/:id', requireAuth, superOnly, async (c) => {
    const { status } = z.object({ status: IssueStatus }).strict().parse(await c.req.json());
    return c.json(setIssueStatus(cfgOf(c).db, c.req.param('id'), status, nowOf(c)));
  });
}
