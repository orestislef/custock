// staff notifications: a push to every member holding a permission at a shop, in their language

import { effectiveAtShop, effectiveAtScope } from '@custock/core';
import { pickLocale, translator } from '@custock/i18n';
import type { Db } from '@custock/db';
import { loadAssignments, loadTopology } from './context';
import { Tenant } from './tenant';
import { devOutboxTransport } from './transport';
import { policyIn } from './policy';

// which personal alert preference covers each staff alert (policy alerts.*)
const ALERT_POLICY: Record<string, string> = {
  lowStock: 'alerts.lowStock', transferSent: 'alerts.transfers', transferReceived: 'alerts.transfers', approvalNeeded: 'alerts.approvals',
  postPublished: 'alerts.approvals', postScheduled: 'alerts.approvals', postReturned: 'alerts.approvals', countReady: 'alerts.counts',
};

export function notifyMembers(
  db: Db,
  orgId: string,
  args: {
    perm: string;
    shopId?: string | null; // null means at org scope
    // instead of one shop: everyone who holds the permission at every one of these scopes (a post's audience)
    scopes?: { scopeType: 'org' | 'group' | 'shop'; scopeId: string }[];
    key: string; // server namespace key under push.*
    params: (locale: string) => Record<string, unknown>;
    payload?: Record<string, unknown>;
    exceptUserId?: string | null;
    silent?: boolean;
    bodyKey?: string; // another text under push.<key>, for example the one with a shortage
  },
): number {
  const t = new Tenant(db, orgId);
  const org = t.get<{ posts_need_approval: number }>('SELECT posts_need_approval FROM organizations WHERE id = @org')!;
  const { topology } = loadTopology(db, orgId);
  const members = t.all<{ id: string; user_id: string; locale: string }>(
    `SELECT m.id, m.user_id, u.locale FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = @org AND m.status = 'active' AND u.deleted_at IS NULL`,
  );
  const transport = devOutboxTransport(db, () => {});
  let name: string | null = null;
  const orgName = () => (name ??= t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org')?.name ?? '');
  let sent = 0;
  for (const m of members) {
    if (m.user_id === args.exceptUserId) continue;
    const { assignments } = loadAssignments(t, m.id, org);
    const holds = args.scopes?.length
      ? args.scopes.every((s) => (s.scopeType === 'shop' ? effectiveAtShop(assignments, topology, s.scopeId) : effectiveAtScope(assignments, topology, s)).perms.has(args.perm))
      : (args.shopId ? effectiveAtShop(assignments, topology, args.shopId) : effectiveAtScope(assignments, topology, { scopeType: 'org', scopeId: orgId })).perms.has(args.perm);
    if (!holds) continue;
    // the person turned this kind of alert off for themselves, or their role or business did
    const pref = ALERT_POLICY[args.key];
    if (pref && !args.silent && policyIn(db, orgId, pref, { userId: m.user_id, shopId: args.shopId ?? null }) === false) continue;
    const locale = pickLocale(m.locale);
    const tr = translator(locale, 'server');
    const params = args.params(locale);
    // someone working for several businesses needs to see which one it is about
    const several = !args.silent && (t.db.prepare("SELECT count(*) AS n FROM memberships WHERE user_id = ? AND status = 'active'").get(m.user_id) as { n: number }).n > 1;
    const title = args.silent ? '' : tr(`push.${args.key}.title`, params);
    transport.send({
      channel: 'push',
      orgId,
      userId: m.user_id,
      locale,
      title: several ? `${orgName()} · ${title}` : title,
      body: args.silent ? '' : tr(`push.${args.key}.${args.bodyKey ?? 'body'}`, params),
      payload: { type: args.key, silent: !!args.silent, ...(args.payload ?? {}) },
    });
    sent++;
  }
  return sent;
}

// one staff alert for one person of this business (the author of a post, for example), in their
// language, if they still work here and did not turn this kind of alert off
export function notifyUser(
  db: Db,
  orgId: string,
  userId: string,
  args: { key: string; params: (locale: string) => Record<string, unknown>; payload?: Record<string, unknown>; bodyKey?: string },
): boolean {
  const t = new Tenant(db, orgId);
  const m = t.get<{ locale: string }>(
    `SELECT u.locale FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = @org AND m.user_id = @u AND m.status = 'active' AND u.deleted_at IS NULL`,
    { u: userId },
  );
  if (!m) return false;
  const pref = ALERT_POLICY[args.key];
  if (pref && policyIn(db, orgId, pref, { userId }) === false) return false;
  const locale = pickLocale(m.locale);
  const tr = translator(locale, 'server');
  const params = args.params(locale);
  const several = (t.db.prepare("SELECT count(*) AS n FROM memberships WHERE user_id = ? AND status = 'active'").get(userId) as { n: number }).n > 1;
  const orgName = several ? t.get<{ name: string }>('SELECT name FROM organizations WHERE id = @org')?.name ?? '' : '';
  const title = tr(`push.${args.key}.title`, params);
  devOutboxTransport(db, () => {}).send({
    channel: 'push',
    orgId,
    userId,
    locale,
    title: several ? `${orgName} · ${title}` : title,
    body: tr(`push.${args.key}.${args.bodyKey ?? 'body'}`, params),
    payload: { type: args.key, ...(args.payload ?? {}) },
  });
  return true;
}

// a silent data push telling one member to refetch their permissions
export function permsChanged(db: Db, orgId: string, userId: string) {
  devOutboxTransport(db, () => {}).send({
    channel: 'push', orgId, userId, title: '', body: '', payload: { type: 'perms_changed', silent: true },
  });
}
