'use client';

// a super admin's limits for one business: for each limit or option the business has, the
// ceiling (or the stricter side it is held to) and whether the owner may change it, with the value
// the business uses now.

import { useState } from 'react';
import { POLICY_GROUPS, policyDef, type BusinessPolicyControl, type PolicyEntry, type PolicyValue } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { PolicyControl, policyText } from '@/components/policy/policy-list';
import { Group, Row, Switch } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { useAsync } from '@/lib/use-async';

type Change = { limit?: PolicyValue | null; delegated?: boolean };

export function BusinessPolicies({ orgId }: { orgId: string }) {
  const { api, t } = usePlatform();
  const toast = useToast();
  const q = useAsync(() => api.businessPolicies(orgId), [orgId]);
  const [busy, setBusy] = useState<string | null>(null);
  const controls = q.data?.controls ?? null;

  const save = async (key: string, change: Change) => {
    setBusy(key);
    try {
      q.setData(await api.setBusinessPolicies(orgId, { [key]: change }));
      toast(t('platform.policies.saved'));
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`, { defaultValue: t('common:error.internal') }));
    } finally {
      setBusy(null);
    }
  };

  if (!controls) return <div className="h-48 rounded-[16px] skel mb-6" aria-busy="true" />;
  return (
    <>
      <h2 className="t-title3 m-0 mb-1 mt-8">{t('platform.policies.businessTitle')}</h2>
      <p className="t-sub t-2 m-0 mb-4">{t('platform.policies.businessLead')}</p>
      {POLICY_GROUPS.map((g) => {
        const list = controls.filter((c) => policyDef(c.key)?.group === g);
        if (!list.length) return null;
        return (
          <Group key={g} title={t(`common:policyGroup.${g}`)}>
            {list.map((c) => <ControlRows key={c.key} c={c} busy={busy === c.key} onSave={(ch) => void save(c.key, ch)} />)}
          </Group>
        );
      })}
    </>
  );
}

function ControlRows({ c, busy, onSave }: { c: BusinessPolicyControl; busy: boolean; onSave: (change: Change) => void }) {
  const { t } = usePlatform();
  const def = policyDef(c.key)!;
  const title = t(`common:policy.${c.key}.title`);
  // a ceiling only means something for limits with a stricter side
  const bounded = def.cap !== 'free';
  // the ceiling itself moves inside the hard bounds only
  const entry: PolicyEntry = {
    key: c.key,
    value: c.limit,
    inherited: def.type === 'int' ? (def.noneIsZero ? 0 : (def.max ?? 0)) : def.type === 'window' ? '00:00-00:00' : c.platform,
    effective: c.limit ?? c.platform,
    editable: true,
  };
  return (
    <>
      {bounded ? <PolicyControl entry={entry} busy={busy} onChange={(v) => onSave({ limit: v })} /> : null}
      <Row title={bounded ? t('platform.policies.ownerCan') : title}
        subtitle={t('platform.policies.now', { value: policyText(t, def, c.business) })}
        trailing={<Switch label={`${t('platform.policies.ownerCan')}: ${title}`} checked={c.delegated} disabled={busy} onChange={(v) => onSave({ delegated: v })} />} />
    </>
  );
}
