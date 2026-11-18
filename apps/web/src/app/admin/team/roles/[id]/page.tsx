'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Switch } from '@/components/ui/kit';
import { Picker, useToast } from '@/components/ui/client-kit';
import { useAsync } from '@/lib/use-async';
import { PERM_GROUPS, rankAt } from '@/lib/perms';
import { roleLabel } from '@/lib/names';
import { RedirectHome } from '@/components/admin/redirect-home';

// a role on its own page: permission groups in two columns, a sticky save with what changes
export default function RoleEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, can } = useAdmin();
  const roles = useAsync(() => (can('roles.manage', null) ? api.roles(org.orgId) : Promise.resolve([] as Role[])), []);
  const role = id === 'new' ? null : roles.data?.find((r) => r.id === id) ?? null;
  if (!can('roles.manage', null)) return <RedirectHome />;
  if (!roles.data) return <Page title={t('roles.edit')}><div className="h-40 skel" /></Page>;
  return <Editor key={role?.id ?? 'new'} role={role} all={roles.data} />;
}

function Editor({ role, all }: { role: Role | null; all: Role[] }) {
  const { api, org, t } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const myRank = rankAt(org);
  const mine = new Set([...org.orgPerms, ...org.anyPerms, ...org.shops.flatMap((s) => s.perms)]);
  const [name, setName] = useState(role ? roleLabel(t, role) : '');
  const below = [...all].filter((r) => r.rank < myRank && r.id !== role?.id).sort((a, b) => b.rank - a.rank);
  // the role can manage the roles under it: pick the highest one it can manage
  const [manages, setManages] = useState<string>(() => {
    const r = role ? below.find((x) => x.rank < role.rank) : below[0] ? below[below.length - 1] : undefined;
    return r?.id ?? 'none';
  });
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const managed = manages === 'none' ? null : below.find((r) => r.id === manages) ?? null;
  const rank = Math.min(myRank - 1, managed ? managed.rank + 1 : 1);
  const diff = useMemo(() => {
    const before = new Set(role?.permissions ?? []);
    return { added: [...perms].filter((p) => !before.has(p)).length, removed: [...before].filter((p) => !perms.has(p)).length };
  }, [perms, role]);
  const changed = diff.added + diff.removed > 0 || name.trim() !== (role ? roleLabel(t, role) : '') || (role != null && rank !== role.rank);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveRole(org.orgId, { ...(role ? { id: role.id } : {}), name: name.trim(), rank, permissions: [...perms] });
      toast(t('roles.saved'));
      router.push('/admin/team/roles');
    } catch (e) {
      setError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
      setBusy(false);
    }
  }

  return (
    <Page title={role ? roleLabel(t, role) : t('roles.new')} back={{ href: '/admin/team/roles', label: t('roles.title') }}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-x-6 items-start">
        <section className="inset-group">
          <ul className="list" role="list">
            <li><label className="block"><span className="field-label">{t('roles.name')}</span><input className="field pt-1" value={name} onChange={(e) => setName(e.target.value)} /></label></li>
            <li className="row row-sep">
              <span className="row-main row-title">{t('roles.manageLabel')}</span>
              <Picker variant="plain" label={t('roles.manageLabel')} value={manages} onChange={setManages}
                options={[{ value: 'none', label: t('roles.nobody') }, ...below.map((r) => ({ value: r.id, label: t('roles.andBelow', { role: roleLabel(t, r) }) }))]} />
            </li>
          </ul>
          <p className="inset-group-foot">
            <span className="block">{managed ? t('roles.canManage', { list: below.filter((r) => r.rank <= managed.rank).map((r) => roleLabel(t, r)).join(', ') }) : t('roles.managesNobody')}</span>
            <span className="block mt-1">{t('roles.manageFoot')}</span>
          </p>
        </section>
        <div />
        {/* only what this person may hand out. anything else on the role stays as it is */}
        {PERM_GROUPS.map((g) => ({ ...g, perms: g.perms.filter((p) => mine.has(p)) })).filter((g) => g.perms.length).map((g) => (
          <section key={g.group} className="inset-group">
            <h2 className="inset-group-head">{t(`common:permGroup.${g.group}`)}</h2>
            <ul className="list" role="list">
              {g.perms.map((p) => (
                <li key={p} className="row">
                  <span className="row-main row-title">{t(`common:perm.${p}`)}</span>
                  <Switch checked={perms.has(p)} label={t(`common:perm.${p}`)} onChange={(v) => setPerms((x) => { const n = new Set(x); if (v) n.add(p); else n.delete(p); return n; })} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-4 z-10 mt-2">
        <div className="glass rounded-[16px] px-4 py-3 flex items-center gap-3 flex-wrap" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 0 0 0.5px var(--c-line)' }}>
          <span className="flex-1 min-w-[160px]">
            {error ? <span className="t-sub block" role="alert" style={{ color: 'var(--c-error)' }}>{error}</span> : null}
            <span className="t-sub block">{t('roles.diff', { added: diff.added, removed: diff.removed })}</span>
            {role && role.memberCount > 0 ? <span className="t-foot t-2 block">{t('roles.affects', { count: role.memberCount })}</span> : null}
          </span>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !changed} onClick={() => void save()}>{t('roles.save')}</button>
        </div>
      </div>
    </Page>
  );
}
