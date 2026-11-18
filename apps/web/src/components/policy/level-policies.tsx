'use client';

// limits for one role, one person, or a person's own alert choices. only what the viewer may
// change is shown; with nothing to change the section is not there at all.

import { useEffect } from 'react';
import type { PolicyEntry, PolicyGroup, PolicyPatch } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { PolicyGroups, usePolicySaver } from '@/components/policy/policy-list';
import { useToast } from '@/components/ui/client-kit';
import { useAsync } from '@/lib/use-async';

type Level = { kind: 'role'; roleId: string } | { kind: 'member'; membershipId: string } | { kind: 'me' };

export function LevelPolicies({ level, title, groups }: { level: Level; title?: string; groups?: readonly PolicyGroup[] }) {
  const { api, org, t } = useAdmin();
  const toast = useToast();
  const load = () =>
    (level.kind === 'role' ? api.rolePolicies(org.orgId, level.roleId) : level.kind === 'member' ? api.memberPolicies(org.orgId, level.membershipId) : api.myPolicies(org.orgId)).catch(() => null);
  const q = useAsync(load, [org.orgId, level.kind === 'role' ? level.roleId : level.kind === 'member' ? level.membershipId : 'me']);
  const save = async (patch: PolicyPatch) => {
    const r = level.kind === 'role' ? await api.setRolePolicies(org.orgId, level.roleId, patch)
      : level.kind === 'member' ? await api.setMemberPolicies(org.orgId, level.membershipId, patch)
        : await api.setMyPolicies(org.orgId, patch);
    toast(t('settings.saved'));
    return r;
  };
  const saver = usePolicySaver(save, q.data?.entries ?? null);
  const { setEntries } = saver;
  useEffect(() => { if (q.data) setEntries(q.data.entries); }, [q.data, setEntries]);
  const entries: PolicyEntry[] = (saver.entries ?? q.data?.entries ?? []).filter((e) => e.editable);
  if (!entries.length) return null;
  return (
    <section className={title ? 'mt-8' : 'mb-4'}>
      {title ? <h2 className="t-title3 m-0 mb-4">{title}</h2> : null}
      <PolicyGroups entries={entries} groups={groups} onlyEditable busyKey={saver.busyKey} onChange={(k, v) => void saver.change(k, v)} />
      {saver.error ? <p className="sheet-error" role="alert">{t(`common:error.${saver.error}`, { defaultValue: t('common:error.internal') })}</p> : null}
    </section>
  );
}
