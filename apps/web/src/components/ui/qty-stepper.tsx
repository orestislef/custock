'use client';

// a quantity with - and + around a field that can be typed in: pieces, or kg/l/m in steps that make
// sense for a counter (a quarter kilo). the value is in base units like the ledger.

import { useState } from 'react';
import { formatQtyInput, parseQtyInput, type Uom } from '@custock/core';
import { IconMinus, IconPlus } from '@/components/ui/icons';
import { useLocale, useT } from '@/lib/i18n-client';

export function QtyStepper({ value, uom, onChange, label, step, min, max, unit = true }: {
  value: number; uom: Uom; onChange: (v: number) => void; label: string; step: number; min: number; max: number; unit?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const type = (s: string) => {
    setText(s);
    const r = parseQtyInput(s, uom, { min: 0, max });
    if (!r.ok || r.value < min) { setBad(true); return; }
    setBad(false);
    onChange(r.value);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)' }} aria-label={t('qty.less', { name: label })}
        disabled={value - step < min} onClick={() => { setText(null); setBad(false); onChange(clamp(value - step)); }}><IconMinus size={18} /></button>
      <input
        aria-label={label}
        aria-invalid={bad || undefined}
        className="t-headline tnum text-center bg-transparent border-0 outline-none w-14"
        style={bad ? { color: 'var(--c-error)' } : undefined}
        inputMode={uom === 'piece' ? 'numeric' : 'decimal'}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={text ?? formatQtyInput(value, uom, locale)}
        onChange={(e) => type(e.target.value)}
        onBlur={() => { setText(null); setBad(false); }}
      />
      {unit && uom !== 'piece' ? <span className="t-sub t-2 -ml-1 mr-1">{t(`common:uom.${uom}`)}</span> : null}
      <button type="button" className="icon-btn" style={{ background: 'var(--c-fill)' }} aria-label={t('qty.more', { name: label })}
        disabled={value + step > max} onClick={() => { setText(null); setBad(false); onChange(clamp(value + step)); }}><IconPlus size={18} /></button>
    </span>
  );
}
