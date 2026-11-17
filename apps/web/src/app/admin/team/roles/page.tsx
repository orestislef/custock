'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Role } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Group, Row, Switch, Why } from '@/components/ui/kit';
import { Sheet, useToast } from '@/components/ui/client-kit';
import { IconChevronLeft, IconLock, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { PERM_GROUPS, rankAt } from '@/lib/perms';

export default function RolesPage() {
  const { api, org, t, can } = useAdmin();
  const roles = useAsync(() => (can('roles.manage', null) ? api.roles(org.orgId) : Promise.resolve([])), []);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const myRank = rankAt(org);

  if (!can('roles.manage', null)) return <Page title={t('roles.title')}><Why>{t('common:error.forbidden')}</Why></Page>;

  return (
    <Page title={t('roles.title')} actions={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><IconPlus size={18} />{t('roles.new')}</button>}>
      <Link href="/admin/team" className="inline-flex items-center min-h-[44px] -ml-2 -mt-3 mb-3 t-body"><IconChevronLeft size={24} />{t('team.title')}</Link>
      <Group title={t('roles.list')} footer={t('roles.foot')}>
        {(roles.data ?? []).map((r) => {
          const locked = r.locked || r.rank >= myRank;
          return (
            <Row key={r.id} title={t(`common:role.${r.templateKey ?? ''}`, { defaultValue: r.name })}
              subtitle={locked ? <Why>{r.locked ? t('roles.lockedOwner') : t('roles.lockedRank')}</Why> : t('roles.summary', { count: r.permissions.length, people: r.memberCount })}
              value={t('roles.rank', { rank: r.rank })}
              onClick={locked ? undefined : () => setEditing(r)} chevron={!locked} />
          );
        })}
      </Group>
      {editing ? <RoleEditor role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void roles.reload(); }} /> : null}
    </Page>
  );
}

function RoleEditor({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const { api, org, t } = useAdmin();
  const toast = useToast();
  const myRank = rankAt(org);
  const mine = new Set([...org.orgPerms, ...org.anyPerms, ...org.shops.flatMap((s) => s.perms)]);
  const [name, setName] = useState(role ? t(`common:role.${role.templateKey ?? ''}`, { defaultValue: role.name }) : '');
  const [rank, setRank] = useState(role?.rank ?? Math.max(1, Math.min(50, myRank - 10)));
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));

  async function save() {
    try {
      await api.saveRole(org.orgId, { ...(role ? { id: role.id } : {}), name: name.trim(), rank, permissions: [...perms] });
      toast(t('roles.saved'));
      onSaved();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  }

  return (
    <Sheet open onClose={onClose} title={role ? t('roles.edit') : t('roles.new')}
      footer={
        <>
          {role && role.memberCount > 0 ? <p className="t-foot t-2 m-0 mb-2 text-center">{t('roles.affects', { count: role.memberCount })}</p> : null}
          <button type="button" className="btn btn-primary btn-large" disabled={!name.trim()} onClick={() => void save()}>{t('common:action.save')}</button>
        </>
      }>
      <div className="list mb-4">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('roles.name')} aria-label={t('roles.name')} />
        <label className="row row-sep relative">
          <span className="row-main">
            <span className="row-title block">{t('roles.rankLabel')}</span>
            <span className="row-sub block">{t('roles.rankSub', { max: myRank - 1 })}</span>
          </span>
          <input type="range" min={1} max={Math.max(1, myRank - 1)} value={Math.min(rank, myRank - 1)} onChange={(e) => setRank(Number(e.target.value))} aria-label={t('roles.rankLabel')} style={{ accentColor: 'var(--c-accent)' }} />
          <span className="tnum t-sub w-8 text-right">{Math.min(rank, myRank - 1)}</span>
        </label>
      </div>
      {PERM_GROUPS.map((g) => (
        <section key={g.group} className="group">
          <h3 className="group-head">{t(`common:permGroup.${g.group}`)}</h3>
          <div className="list">
            {g.perms.map((p) => {
              const have = mine.has(p);
              return (
                <Row key={p} title={<span style={{ color: have ? 'var(--c-ink)' : 'var(--c-ink-3)' }}>{t(`common:perm.${p}`)}</span>}
                  subtitle={have ? undefined : <span className="why"><IconLock size={12} />{t('common:why.youDoNotHave')}</span>}
                  trailing={<Switch checked={perms.has(p)} disabled={!have} label={t(`common:perm.${p}`)} onChange={(v) => setPerms((x) => { const n = new Set(x); if (v) n.add(p); else n.delete(p); return n; })} />} />
              );
            })}
          </div>
        </section>
      ))}
    </Sheet>
  );
}
