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

  // the business's own value, for settings without a ceiling: a super admin sets it directly
  const saveValue = async (key: string, value: PolicyValue | null) => {
    setBusy(key);
    try {
      await api.setOrgPolicies(orgId, { [key]: value });
      q.setData(await api.businessPolicies(orgId));
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
          <section key={g} className="mb-6">
            <h3 className="t-headline m-0 mb-2 px-1">{t(`common:policyGroup.${g}`)}</h3>
            {list.map((c) => (
              <ControlBlock key={c.key} c={c} busy={busy === c.key}
                onSave={(ch) => void save(c.key, ch)} onValue={(v) => void saveValue(c.key, v)} />
            ))}
          </section>
        );
      })}
    </>
  );
}

// one setting as one group: its name on top, the control that fits its type, and under it a
// separate row for whether the owner may change it. a setting with a stricter side gets the
// ceiling it is held to; a free one gets the business's own value.
function ControlBlock({ c, busy, onSave, onValue }: { c: BusinessPolicyControl; busy: boolean; onSave: (change: Change) => void; onValue: (v: PolicyValue | null) => void }) {
  const { t } = usePlatform();
  const def = policyDef(c.key)!;
  const title = t(`common:policy.${c.key}.title`);
  const bounded = def.cap !== 'free';
  const inUse = t('platform.policies.inUse', { value: policyText(t, def, c.business) });
  const entry: PolicyEntry = bounded
    ? {
        key: c.key,
        value: c.limit,
        // the ceiling itself moves inside the hard bounds only
        inherited: def.type === 'int' ? (def.noneIsZero ? 0 : (def.max ?? 0)) : def.type === 'window' ? '00:00-00:00' : c.platform,
        effective: c.limit ?? c.platform,
        editable: true,
      }
    : { key: c.key, value: c.business, inherited: c.platform, effective: c.business, editable: true };
  const foot = t(`common:policy.${c.key}.foot`, { defaultValue: '' });
  return (
    <div data-policy-block={c.key}>
    <Group title={title} footer={foot || undefined}>
      <PolicyControl entry={entry} busy={busy}
        title={bounded ? t(`platform.policies.ceiling.${def.cap}`) : t('platform.policies.value')}
        subtitle={bounded ? inUse : undefined}
        onChange={(v) => (bounded ? onSave({ limit: v }) : onValue(v))} />
      <Row title={t('platform.policies.ownerCan')}
        subtitle={c.delegated ? t('platform.policies.ownerCanOn') : t('platform.policies.ownerCanOff')}
        trailing={<span data-policy-delegate={c.key} className="contents"><Switch label={`${t('platform.policies.ownerCan')}: ${title}`} checked={c.delegated} disabled={busy} onChange={(v) => onSave({ delegated: v })} /></span>} />
    </Group>
    </div>
  );
}
