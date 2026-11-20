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

function Stepper({ def, value, min, max, onChange, label, busy }: { def: PolicyDef; value: number; min: number; max: number; onChange: (v: number) => void; label: string; busy?: boolean }) {
  const t = useT();
  // a step that fits the range: minutes in fives, wide ranges in tens or hundreds
  const span = max - min;
  const step = def.unit === 'minutes' ? 5 : span > 2000 ? 100 : span > 200 ? 10 : 1;
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  // the number itself can be typed, for values far from where they are
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    setTyping(false);
    if (draft === '') return;
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) set(Math.round(n));
  };
  return (
    <span className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={t('common:policyValue.less', { name: label })} disabled={busy || value <= min} onClick={() => set(value - step)}>
        <IconMinus size={18} />
      </button>
      {typing ? (
        <input className="field tnum text-center w-[88px]" type="text" inputMode="numeric" enterKeyHint="done" autoComplete="off" autoFocus
          aria-label={label} value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setTyping(false); }
          }} />
      ) : (
        <button type="button" className="t-body tnum min-w-[72px] min-h-[44px] text-center rounded-[10px]" disabled={busy}
          aria-label={t('common:policyValue.type', { name: label, value: policyText(t, def, value) })}
          onClick={() => { setDraft(String(value)); setTyping(true); }}>
          <span aria-live="polite">{policyText(t, def, value)}</span>
        </button>
      )}
      <button type="button" className="icon-btn" aria-label={t('common:policyValue.more', { name: label })} disabled={busy || value >= max} onClick={() => set(value + step)}>
        <IconPlus size={18} />
      </button>
    </span>
  );
}

// the bound a value has to stay inside, for the stepper's ends
function rangeFor(def: PolicyDef, inherited: PolicyValue, hard = false): { min: number; max: number } {
  let min = def.min ?? 0;
  let max = def.max ?? 100;
  // the platform level has nothing above it: only the registry's own bounds hold there
  if (hard) return { min, max };
  if (def.cap === 'max' && !(def.noneIsZero && inherited === 0)) max = Math.min(max, Number(inherited));
  if (def.cap === 'min') min = Math.max(min, Number(inherited));
  return { min, max };
}

export function PolicyControl({ entry, onChange, busy, title: titleOverride, subtitle, hardBounds }: { entry: PolicyEntry; onChange: (v: PolicyValue | null) => void; busy?: boolean; title?: string; subtitle?: string; hardBounds?: boolean }) {
  const t = useT();
  const def = policyDef(entry.key);
  if (!def) return null;
  const text = titleOverride ?? t(`common:policy.${def.key}.title`);
  // the key on the title and a marker on the control, so a missing control can be found
  const title = <span data-policy={def.key}>{text}</span>;
  const control = (node: ReactNode) => <span data-policy-control={def.key} className="contents">{node}</span>;
  const current = entry.effective;
  if (!entry.editable) return <Row title={title} subtitle={subtitle} value={policyText(t, def, current)} />;
  if (def.type === 'bool') {
    // a stricter side the level above already forces cannot be undone here
    const locked = !hardBounds && ((def.cap === 'require' && entry.inherited === true) || (def.cap === 'allow' && entry.inherited === false));
    if (locked) return <Row title={title} subtitle={subtitle} value={policyText(t, def, current)} />;
    return <Row title={title} subtitle={subtitle} trailing={control(<Switch checked={current === true} label={text} disabled={busy} onChange={(v) => onChange(v)} />)} />;
  }
  if (def.type === 'enum') {
    return (
      // a long choice ("order at the shown prices" in greek) goes under the name instead of squeezing it
      <div className="row flex-wrap gap-y-1">
        <span className="row-main min-w-[9rem]"><span className="row-title block">{title}</span>{subtitle ? <span className="row-sub block">{subtitle}</span> : null}</span>
        {control(
          <Picker variant="plain" label={text} value={String(current)} disabled={busy}
            options={(def.options ?? []).map((o) => ({ value: o, label: t(`common:policyOption.${def.key}.${o}`) }))}
            onChange={(v) => onChange(v)} />,
        )}
      </div>
    );
  }
  if (def.type === 'window') {
    const [from, to] = String(current).split('-') as [string, string];
    return (
      // on a narrow phone the two times go under the name instead of squeezing it
      <div className="row flex-wrap gap-y-1">
        <span className="row-main min-w-[9rem]"><span className="row-title block">{title}</span>{subtitle ? <span className="row-sub block">{subtitle}</span> : null}</span>
        <span className="flex items-center gap-2 ml-auto" data-policy-control={def.key}>
          <Picker variant="plain" label={t('common:policyValue.from', { name: text })} value={from} disabled={busy} options={TIMES.map((x) => ({ value: x, label: x }))} onChange={(v) => onChange(`${v}-${to}`)} />
          <span className="t-2" aria-hidden="true">–</span>
          <Picker variant="plain" label={t('common:policyValue.to', { name: text })} value={to} disabled={busy} options={TIMES.map((x) => ({ value: x, label: x }))} onChange={(v) => onChange(`${from}-${v}`)} />
        </span>
      </div>
    );
  }
  const { min, max } = rangeFor(def, entry.inherited, hardBounds);
  return (
    // like the time window: on a narrow phone the stepper goes under the name instead of squeezing it
    <div className="row flex-wrap gap-y-1">
      <span className="row-main min-w-[9rem]"><span className="row-title block">{title}</span>{subtitle ? <span className="row-sub block">{subtitle}</span> : null}</span>
      <span className="ml-auto" data-policy-control={def.key}>
        <Stepper def={def} value={Number(current)} min={min} max={max} label={text} busy={busy} onChange={(v) => onChange(v)} />
      </span>
    </div>
  );
}

// entries grouped like the registry, one inset group each, with the key's own footnote
export function PolicyGroups({ entries, onChange, busyKey, groups, onlyEditable, footers = true, extra, hardBounds }: {
  entries: PolicyEntry[];
  hardBounds?: boolean;
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
        // the same sentence once, when two settings share it
        const foot = footers ? [...new Set(list.filter((e) => e.editable).map((e) => t(`common:policy.${e.key}.foot`, { defaultValue: '' })).filter(Boolean))].join(' ') : '';
        return (
          <Group key={g} title={t(`common:policyGroup.${g}`)} footer={foot || undefined}>
            {list.map((e) => <PolicyControl key={e.key} entry={e} busy={busyKey === e.key} hardBounds={hardBounds} onChange={(v) => onChange(e.key, v)} />)}
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
