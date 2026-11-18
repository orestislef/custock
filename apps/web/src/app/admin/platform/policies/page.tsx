'use client';

// the platform values of every limit and option: what every business starts from and, for the
// limits, the ceiling unless a business gets its own. safety values have minimums they never go
// under (packages/core/src/policies.ts).

import { POLICY_GROUPS, type PlatformPolicyEntry, type PolicyEntry, type PolicyValue } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { PolicyGroups, usePolicySaver } from '@/components/policy/policy-list';
import { useToast } from '@/components/ui/client-kit';
import { useAsync } from '@/lib/use-async';

export default function PlatformPoliciesPage() {
  return (
    <PlatformShell>
      <Defaults />
    </PlatformShell>
  );
}

// the platform list in the shape the shared controls take: always editable, inherits the built in default
function asEntries(list: PlatformPolicyEntry[]): PolicyEntry[] {
  return list.map((e) => ({ key: e.key, value: e.value, inherited: e.default, effective: e.effective, editable: true }));
}

function Defaults() {
  const { api, t } = usePlatform();
  const toast = useToast();
  const q = useAsync(() => api.platformPolicies(), []);
  const saver = usePolicySaver(async (p) => {
    const r = await api.setPlatformPolicies(p);
    toast(t('platform.policies.saved'));
    return { entries: asEntries(r.entries) };
  }, q.data ? asEntries(q.data.entries) : null);
  const entries = saver.entries ?? (q.data ? asEntries(q.data.entries) : null);
  const changed = (entries ?? []).filter((e) => e.value !== null);

  const resetAll = async () => {
    const all = Object.fromEntries(changed.map((e) => [e.key, null]));
    const r = await api.setPlatformPolicies(all);
    saver.setEntries(asEntries(r.entries));
    toast(t('platform.policies.saved'));
  };

  return (
    <Page title={t('platform.policies.title')} back={{ href: '/admin/platform', label: t('platform.title') }} subtitle={t('platform.policies.sub')}>
      {!entries ? <div className="h-64 rounded-[16px] skel" aria-busy="true" /> : (
        <>
          <PolicyGroups entries={entries} groups={POLICY_GROUPS} busyKey={saver.busyKey} onChange={(k, v: PolicyValue | null) => void saver.change(k, v)} />
          {saver.error ? <p className="sheet-error" role="alert">{t(`common:error.${saver.error}`, { defaultValue: t('common:error.internal') })}</p> : null}
          {changed.length ? (
            <div className="flex justify-center mt-2 mb-8">
              <button type="button" className="btn btn-gray" onClick={() => void resetAll()}>{t('platform.policies.reset')}</button>
            </div>
          ) : null}
        </>
      )}
    </Page>
  );
}
