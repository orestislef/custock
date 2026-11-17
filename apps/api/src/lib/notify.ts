// staff notifications: a push to every member holding a permission at a shop, in their language

import { effectiveAtShop, effectiveAtScope } from '@custock/core';
import { pickLocale, translator } from '@custock/i18n';
import type { Db } from '@custock/db';
import { loadAssignments, loadTopology } from './context';
import { Tenant } from './tenant';
import { devOutboxTransport } from './transport';

export function notifyMembers(
  db: Db,
  orgId: string,
  args: {
    perm: string;
    shopId?: string | null; // null means at org scope
    key: string; // server namespace key under push.*
    params: (locale: string) => Record<string, unknown>;
    payload?: Record<string, unknown>;
    exceptUserId?: string | null;
    silent?: boolean;
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
  let sent = 0;
  for (const m of members) {
    if (m.user_id === args.exceptUserId) continue;
    const { assignments } = loadAssignments(t, m.id, org);
    const eff = args.shopId ? effectiveAtShop(assignments, topology, args.shopId) : effectiveAtScope(assignments, topology, { scopeType: 'org', scopeId: orgId });
    if (!eff.perms.has(args.perm)) continue;
    const locale = pickLocale(m.locale);
    const tr = translator(locale, 'server');
    const params = args.params(locale);
    transport.send({
      channel: 'push',
      orgId,
      userId: m.user_id,
      locale,
      title: args.silent ? '' : tr(`push.${args.key}.title`, params),
      body: args.silent ? '' : tr(`push.${args.key}.body`, params),
      payload: { type: args.key, silent: !!args.silent, ...(args.payload ?? {}) },
    });
    sent++;
  }
  return sent;
}

// a silent data push telling one member to refetch their permissions
export function permsChanged(db: Db, orgId: string, userId: string) {
  devOutboxTransport(db, () => {}).send({
    channel: 'push', orgId, userId, title: '', body: '', payload: { type: 'perms_changed', silent: true },
  });
}
