// a small error tracker of our own. every failure worth a look (an api 5xx, a worker job that
// threw, a message that could not be sent, a storage call that failed, an error in a browser) is
// scrubbed, fingerprinted and counted on one row per issue in error_events. a brand new issue
// emails the super admins a short notice, at most once per issue and 10 times a day in total.
// capture never throws: a broken tracker must not break the thing it watches.

import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { uuidv7, type IssueKind } from '@custock/core';
import type { Db } from '@custock/db';
import type { AppEnv } from '../types';
import { platform } from './tenant';
import { devOutboxTransport, emailMessage } from './transport';
import { errorNoticeEmail } from '../email/errors';
import { pushSuperadmins } from './platform-notify';
import { policyNumber } from './policy';

const DAY = 86_400_000;
export const ERROR_KEEP_MS = 30 * DAY;
export const ERROR_MAX_ISSUES = 500;
// browsers are many and noisy: past this many distinct client issues, new ones are folded into one
export const ERROR_MAX_CLIENT_ISSUES = 200;
export const ERROR_NOTICES_PER_DAY = 10;

let webBase = 'http://localhost:3000';
// CUSTOCK_PUBLIC_WEB_URL, for the link in the notice email
export function setErrorWebBase(url: string | undefined) {
  if (url) webBase = url.replace(/\/$/, '');
}

// ---------------------------------------------------------------- scrubbing

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// removes what must never be stored: emails, tokens, passwords, secrets in urls and query strings,
// ip addresses and long numbers. ids (uuids) stay, they are how an issue is traced
export function scrub(input: string): string {
  return input
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[credentials]@')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]')
    .replace(/\?[^\s"'<>#)]*=[^\s"'<>#)]*/g, '?[query]')
    .replace(/\b(password|passwd|pwd|pass|secret|token|access_token|refresh_token|api[_-]?key|apikey|authorization|cookie|set-cookie|session|signature|sig|private[_-]?key)(\s*["']?\s*[:=]\s*["']?)([^\s"'&,;)}]+)/gi, '$1$2[redacted]')
    .replace(/\b(code|otp)(\s*["']?\s*[:=]\s*["']?)(\d{4,8})\b/gi, '$1$2[redacted]')
    .replace(/\b(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)[A-Za-z0-9_-]{32,}/g, '[secret]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[number]');
}

// a stack without absolute paths, at most 15 frames
export function cleanStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const lines = scrub(stack)
    .split('\n')
    .map((l) => l.replace(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:[^\s()/\\]*[/\\])+?((?:apps|packages|node_modules|_next)[/\\])/g, '$1').trimEnd())
    .filter(Boolean);
  return lines.slice(0, 16).join('\n').slice(0, 4000) || null;
}

// the first frame that is ours, without line and column, so a new release does not split an issue
export function topFrame(stack: string | null): string | null {
  if (!stack) return null;
  for (const raw of stack.split('\n').slice(1)) {
    const l = raw.trim();
    if (!l.startsWith('at ') && !l.includes('@')) continue;
    if (/node_modules|node:internal|\(native\)|<anonymous>/.test(l)) continue;
    return l.replace(/^at\s+/, '').replace(/:\d+(?::\d+)?\)?$/, (m) => (m.endsWith(')') ? ')' : '')).slice(0, 200);
  }
  return null;
}

// what makes two occurrences the same issue: ids, numbers and hashes do not count
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID, ':id')
    .replace(/\b[0-9a-f]{8,}\b/gi, 'X')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// a path as a pattern: ids, numbers and token like segments become placeholders
export function normalizeRoute(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0]!;
  return clean
    .split('/')
    .map((seg) => (IS_UUID.test(seg) ? ':id' : /^\d+$/.test(seg) ? ':n' : /^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':token' : seg))
    .join('/')
    .slice(0, 200);
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message || 'error'}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? 'error';
  } catch {
    return 'error';
  }
}

export function releaseRevision(env: Record<string, string | undefined> = process.env): string | null {
  const r = env.CUSTOCK_REV ?? env.CUSTOCK_BUILD_REV ?? env.CUSTOCK_REVISION ?? env.CUSTOCK_RELEASE ?? null;
  return r && /^[A-Za-z0-9._-]{1,64}$/.test(r) ? r : null;
}

// ---------------------------------------------------------------- capture

export interface CaptureInput {
  kind: IssueKind;
  error?: unknown;
  message?: string;
  stack?: string | null;
  // a route pattern, a job kind, a channel, a page path
  route?: string | null;
  method?: string | null;
  status?: number | null;
  userId?: string | null;
  orgId?: string | null;
  browser?: string | null;
  os?: string | null;
  build?: string | null;
  requestId?: string | null;
}

export interface CaptureResult {
  id: string;
  isNew: boolean;
}

// records one occurrence. returns the issue, or null when the tracker itself failed
export function captureError(db: Db, input: CaptureInput, opts: { now?: number; notify?: boolean } = {}): CaptureResult | null {
  try {
    return capture(db, input, opts.now ?? Date.now(), opts.notify !== false);
  } catch (e) {
    console.error('[errors] could not record an error', e);
    return null;
  }
}

function capture(db: Db, input: CaptureInput, now: number, notify: boolean): CaptureResult {
  const p = platform(db);
  const message = scrub(input.message ?? messageOf(input.error)).slice(0, 500) || 'error';
  const stack = cleanStack(input.stack ?? (input.error instanceof Error ? input.error.stack : null));
  const frame = topFrame(stack);
  const route = normalizeRoute(input.route);
  let kind = input.kind;
  let title = message.split('\n')[0]!.slice(0, 200);
  let fingerprint = hash([kind, normalizeMessage(message), frame ?? '', route ?? ''].join('|'));

  const example = {
    at: now,
    message,
    stack,
    method: input.method ?? null,
    route,
    status: input.status ?? null,
    release: releaseRevision(),
    userId: input.userId ?? null,
    orgId: input.orgId ?? null,
    browser: input.browser ?? null,
    os: input.os ?? null,
    build: input.build ?? null,
    requestId: input.requestId ?? null,
  };

  return db.transaction((): CaptureResult => {
    let row = p.get<{ id: string; status: string }>('SELECT id, status FROM error_events WHERE fingerprint = @f', { f: fingerprint });
    if (!row && kind === 'client') {
      const clients = p.get<{ n: number }>("SELECT count(*) AS n FROM error_events WHERE kind = 'client'")!.n;
      if (clients >= ERROR_MAX_CLIENT_ISSUES) {
        fingerprint = hash('client|overflow');
        title = 'More browser errors than the tracker keeps apart';
        kind = 'client';
        row = p.get<{ id: string; status: string }>('SELECT id, status FROM error_events WHERE fingerprint = @f', { f: fingerprint });
      }
    }
    if (row) {
      // ignored stays ignored, resolved comes back: it happened again
      p.run(
        `UPDATE error_events SET count = count + 1, last_seen = @now, example = @ex,
           status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
           resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END
         WHERE id = @id`,
        { id: row.id, now, ex: JSON.stringify(example) },
      );
      return { id: row.id, isNew: false };
    }
    const id = uuidv7(now);
    p.run(
      `INSERT INTO error_events (id, fingerprint, kind, title, route, frame, status, count, first_seen, last_seen, example)
       VALUES (@id, @f, @kind, @title, @route, @frame, 'open', 1, @now, @now, @ex)`,
      { id, f: fingerprint, kind, title, route, frame, now, ex: JSON.stringify(example) },
    );
    pruneErrors(db, now);
    if (notify) noticeSuperadmins(db, id, now);
    return { id, isNew: true };
  })();
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40);

// older than 30 days goes, and never more than 500 issues: the oldest seen go first
export function pruneErrors(db: Db, now = Date.now()): number {
  const p = platform(db);
  let gone = p.run('DELETE FROM error_events WHERE last_seen < @cut', { cut: now - policyNumber(db, 'retention.errorDays') * DAY }).changes;
  const n = p.get<{ n: number }>('SELECT count(*) AS n FROM error_events')!.n;
  if (n > ERROR_MAX_ISSUES) {
    gone += p.run('DELETE FROM error_events WHERE id IN (SELECT id FROM error_events ORDER BY last_seen ASC LIMIT @over)', { over: n - ERROR_MAX_ISSUES }).changes;
  }
  return gone;
}

// a short email to every super admin about a brand new issue, through the normal outbox
function noticeSuperadmins(db: Db, issueId: string, now: number) {
  const p = platform(db);
  const sentToday = p.get<{ n: number }>('SELECT count(*) AS n FROM error_events WHERE notified_at >= @since', { since: now - DAY })!.n;
  if (sentToday >= ERROR_NOTICES_PER_DAY) return;
  const issue = p.get<{ kind: IssueKind; title: string; route: string | null }>('SELECT kind, title, route FROM error_events WHERE id = @id', { id: issueId });
  if (!issue) return;
  const admins = p.all<{ id: string; email: string; locale: string | null }>(
    "SELECT id, email, locale FROM users WHERE platform_role = 'superadmin' AND deleted_at IS NULL AND email IS NOT NULL",
  );
  if (!admins.length) return;
  const outbox = devOutboxTransport(db, () => {});
  const url = `${webBase}/admin/platform/errors/${issueId}`;
  for (const a of admins) {
    const r = errorNoticeEmail(a.locale, { kind: issue.kind, title: issue.title, route: issue.route, url });
    outbox.send(emailMessage(r, { userId: a.id, to: a.email, locale: a.locale, payload: { type: 'error_notice', issueId } }));
  }
  // and a push on the devices where they turned alerts on, under the same once per issue rule
  pushSuperadmins(db, 'error', { title: issue.title.slice(0, 120), kind: issue.kind }, { path: `/admin/platform/errors/${issueId}`, tag: `error-${issueId}` });
  p.run('UPDATE error_events SET notified_at = @now WHERE id = @id', { now, id: issueId });
}

// ---------------------------------------------------------------- the api

const captured = new WeakSet<Request>();

function routePattern(c: Context<AppEnv>): string {
  try {
    const routes = (c.req as unknown as { matchedRoutes?: { method: string; path: string }[] }).matchedRoutes ?? [];
    const own = routes.filter((r) => r.method !== 'ALL' && !r.path.includes('*'));
    const last = own[own.length - 1];
    if (last) return last.path;
  } catch {
    // fall back to the path itself
  }
  return c.req.path;
}

// every 5xx the api answers, thrown or returned, once per request
export const captureServerErrors: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status < 500 || captured.has(c.req.raw)) return;
  captured.add(c.req.raw);
  const cfg = c.get('cfg');
  if (!cfg?.db) return;
  const user = c.get('user') as { id?: string } | undefined;
  const org = c.get('org') as { org?: { id?: string } } | undefined;
  const err = (c as unknown as { error?: unknown }).error;
  captureError(
    cfg.db,
    {
      kind: 'api',
      error: err,
      message: err ? undefined : `HTTP ${c.res.status}`,
      route: routePattern(c),
      method: c.req.method,
      status: c.res.status,
      userId: user?.id ?? null,
      orgId: org?.org?.id ?? null,
      requestId: c.get('requestId') ?? null,
    },
    { now: cfg.now?.() ?? Date.now() },
  );
};
