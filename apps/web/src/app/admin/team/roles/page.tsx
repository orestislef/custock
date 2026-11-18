'use client';

import Link from 'next/link';
import type { Role } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Row } from '@/components/ui/kit';
import { IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { rankAt } from '@/lib/perms';
import { roleLabel } from '@/lib/names';
import { RedirectHome } from '@/components/admin/redirect-home';

export default function RolesPage() {
  const { api, org, t, can } = useAdmin();
  const roles = useAsync(() => (can('roles.manage', null) ? api.roles(org.orgId) : Promise.resolve([] as Role[])), []);
  const myRank = rankAt(org);
  const all = [...(roles.data ?? [])].sort((a, b) => b.rank - a.rank);
  const below = (r: Role) => all.filter((x) => x.rank < r.rank).map((x) => roleLabel(t, x));

  if (!can('roles.manage', null)) return <RedirectHome />;

  return (
    <Page title={t('roles.title')} back={{ href: '/admin/team', label: t('team.title') }}
      actions={<Link href="/admin/team/roles/new" className="btn btn-primary"><IconPlus size={18} />{t('roles.new')}</Link>}
      phoneAction={<Link href="/admin/team/roles/new" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('roles.new')}><IconPlus size={22} /></Link>}>
      <section className="inset-group">
        <h2 className="inset-group-head">{t('roles.list')}</h2>
        <ul className="list" role="list">
          {all.map((r) => {
            const locked = r.locked || r.rank >= myRank;
            const manages = below(r);
            const sub = (
              <span className="block">
                <span className="block">{t('roles.perms', { count: r.permissions.length })} · {t('roles.people', { count: r.memberCount })}</span>
                <span className="block">{manages.length ? t('roles.canManage', { list: manages.join(', ') }) : t('roles.managesNobody')}</span>
              </span>
            );
            return <li key={r.id}><Row title={roleLabel(t, r)} subtitle={sub} href={locked ? undefined : `/admin/team/roles/${r.id}`} chevron={!locked} /></li>;
          })}
        </ul>
      </section>
    </Page>
  );
}
