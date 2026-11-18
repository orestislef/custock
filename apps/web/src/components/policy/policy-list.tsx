'use client';

// limits and options from the policy engine (packages/core/src/policies.ts), drawn from the
// registry: a stepper for numbers, a switch for yes or no, a picker for choices, two time pickers
// for a window. a value someone may change gets a control, anything else is only its value.
// nothing here explains why a control is missing: the screen shows what the person can do.

import { useState, type ReactNode } from 'react';
import { policyDef, POLICY_GROUPS, type PolicyDef, type PolicyEntry, type PolicyGroup, type PolicyValue } from '@custock/core';
import { Group, Row, Switch } from '@/components/ui/kit';
import { Picker } from '@/components/ui/client-kit';
import { IconMinus, IconPlus } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';

type T = ReturnType<typeof useT>;

// the value as a person reads it
export function policyText(t: T, def: PolicyDef, v: PolicyValue): string {
  if (def.type === 'bool') return t(v ? 'common:policyValue.on' : 'common:policyValue.off');
  if (def.type === 'enum') return t(`common:policyOption.${def.key}.${String(v)}`);
  if (def.type === 'window') {
    const [from, to] = String(v).split('-');
    return t('common:policyValue.window', { from, to });
  }
  const n = Number(v);
  if (def.noneIsZero && n === 0) return t('common:policyValue.none');
  return t(`common:policyUnit.${def.unit ?? 'count'}`, { count: n });
}

const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

function Stepper({ def, value, min, max, onChange, label }: { def: PolicyDef; value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const t = useT();
  const step = def.unit === 'minutes' ? 5 : 1;
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <span className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={t('common:policyValue.less', { name: label })} disabled={value <= min} onClick={() => set(value - step)}>
        <IconMinus size={18} />
      </button>
      <span className="t-body tnum min-w-[72px] text-center" aria-live="polite">{policyText(t, def, value)}</span>
      <button type="button" className="icon-btn" aria-label={t('common:policyValue.more', { name: label })} disabled={value >= max} onClick={() => set(value + step)}>
        <IconPlus size={18} />
      </button>
    </span>
  );
}

// the bound a value has to stay inside, for the stepper's ends
function rangeFor(def: PolicyDef, inherited: PolicyValue): { min: number; max: number } {
  let min = def.min ?? 0;
  let max = def.max ?? 100;
  if (def.cap === 'max' && !(def.noneIsZero && inherited === 0)) max = Math.min(max, Number(inherited));
  if (def.cap === 'min') min = Math.max(min, Number(inherited));
  return { min, max };
}

export function PolicyControl({ entry, onChange, busy }: { entry: PolicyEntry; onChange: (v: PolicyValue | null) => void; busy?: boolean }) {
  const t = useT();
  const def = policyDef(entry.key);
  if (!def) return null;
  const title = t(`common:policy.${def.key}.title`);
  const current = entry.effective;
  if (!entry.editable) return <Row title={title} value={policyText(t, def, current)} />;
  if (def.type === 'bool') {
    // a stricter side the level above already forces cannot be undone here
    const locked = (def.cap === 'require' && entry.inherited === true) || (def.cap === 'allow' && entry.inherited === false);
    if (locked) return <Row title={title} value={policyText(t, def, current)} />;
    return <Row title={title} trailing={<Switch checked={current === true} label={title} disabled={busy} onChange={(v) => onChange(v)} />} />;
  }
  if (def.type === 'enum') {
    return (
      <Row title={title} trailing={
        <Picker variant="plain" label={title} value={String(current)} disabled={busy}
          options={(def.options ?? []).map((o) => ({ value: o, label: t(`common:policyOption.${def.key}.${o}`) }))}
          onChange={(v) => onChange(v)} />
      } />
    );
  }
  if (def.type === 'window') {
    const [from, to] = String(current).split('-') as [string, string];
    return (
      <div className="row">
        <span className="row-main"><span className="row-title block">{title}</span></span>
        <span className="flex items-center gap-2">
          <Picker variant="plain" label={t('common:policyValue.from', { name: title })} value={from} disabled={busy} options={TIMES.map((x) => ({ value: x, label: x }))} onChange={(v) => onChange(`${v}-${to}`)} />
          <span className="t-2" aria-hidden="true">–</span>
          <Picker variant="plain" label={t('common:policyValue.to', { name: title })} value={to} disabled={busy} options={TIMES.map((x) => ({ value: x, label: x }))} onChange={(v) => onChange(`${from}-${v}`)} />
        </span>
      </div>
    );
  }
  const { min, max } = rangeFor(def, entry.inherited);
  return <Row title={title} trailing={<Stepper def={def} value={Number(current)} min={min} max={max} label={title} onChange={(v) => onChange(v)} />} />;
}

// entries grouped like the registry, one inset group each, with the key's own footnote
export function PolicyGroups({ entries, onChange, busyKey, groups, onlyEditable, footers = true, extra }: {
  entries: PolicyEntry[];
  onChange: (key: string, v: PolicyValue | null) => void;
  busyKey?: string | null;
  groups?: readonly PolicyGroup[];
  onlyEditable?: boolean;
  footers?: boolean;
  extra?: Partial<Record<PolicyGroup, ReactNode>>;
}) {
  const t = useT();
  const shown = entries.filter((e) => (!onlyEditable || e.editable) && policyDef(e.key));
  return (
    <>
      {(groups ?? POLICY_GROUPS).map((g) => {
        const list = shown.filter((e) => policyDef(e.key)!.group === g);
        if (!list.length) return null;
        const foot = footers ? list.filter((e) => e.editable).map((e) => t(`common:policy.${e.key}.foot`, { defaultValue: '' })).filter(Boolean).join(' ') : '';
        return (
          <Group key={g} title={t(`common:policyGroup.${g}`)} footer={foot || undefined}>
            {list.map((e) => <PolicyControl key={e.key} entry={e} busy={busyKey === e.key} onChange={(v) => onChange(e.key, v)} />)}
            {extra?.[g]}
          </Group>
        );
      })}
    </>
  );
}

// a list that saves each change at once and keeps the answer
export function usePolicySaver(save: (patch: Record<string, PolicyValue | null>) => Promise<{ entries: PolicyEntry[] }>, initial: PolicyEntry[] | null) {
  const [entries, setEntries] = useState<PolicyEntry[] | null>(initial);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = async (key: string, v: PolicyValue | null) => {
    setBusyKey(key);
    setError(null);
    // the screen moves first, the answer from the server is the truth
    setEntries((list) => list?.map((e) => (e.key === key ? { ...e, value: v, effective: v ?? e.inherited } : e)) ?? list);
    try {
      const r = await save({ [key]: v });
      setEntries(r.entries);
    } catch (err) {
      setError((err as { code?: string }).code ?? 'internal');
      setEntries(initial);
    } finally {
      setBusyKey(null);
    }
  };
  return { entries, setEntries, busyKey, error, change };
}
