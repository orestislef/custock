'use client';

// a shop's opening hours in its sheet: a row per weekday with an open switch and the times in
// quarters of an hour (up to three ranges a day, for a lunch break), monday's hours for tuesday to
// friday in one tap, and a note for what does not fit.

import { WEEKDAYS, type HoursRange, type ShopHours, type Weekday } from '@custock/core';
import { LIMITS } from '@custock/core';
import { Switch } from '@/components/ui/kit';
import { Picker } from '@/components/ui/client-kit';
import { IconMinus, IconPlus } from '@/components/ui/icons';
import { useLocale, useT } from '@/lib/i18n-client';
import { intlLocale } from '@/lib/format';

const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const FROM = QUARTERS.map((x) => ({ value: x, label: x }));
const TO = [...QUARTERS.slice(1), '24:00'].map((x) => ({ value: x, label: x }));
const dayName = (d: Weekday, locale: string) =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(d))));

export function HoursEditor({ week, note, onWeek, onNote, invalid }: {
  week: ShopHours['week']; note: string; onWeek: (w: ShopHours['week']) => void; onNote: (v: string) => void; invalid: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const setDay = (d: Weekday, ranges: HoursRange[]) => onWeek({ ...week, [d]: ranges });
  const setRange = (d: Weekday, i: number, patch: Partial<HoursRange>) => setDay(d, week[d].map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <section className="inset-group mt-6">
      <h3 className="inset-group-head">{t('settings.shops.hours.title')}</h3>
      <ul className="list" role="list">
        {WEEKDAYS.map((d) => {
          const name = dayName(d, locale);
          const ranges = week[d];
          return (
            <li key={d} className="row-sep first:border-0" data-day={d}>
              <div className="row">
                <span className="row-main row-title capitalize">{name}</span>
                {!ranges.length ? <span className="t-sub t-2 mr-2">{t('common:hours.closed')}</span> : null}
                <Switch checked={ranges.length > 0} label={t('settings.shops.hours.openOn', { day: name })}
                  onChange={(on) => setDay(d, on ? [{ from: '09:00', to: '17:00' }] : [])} />
              </div>
              {ranges.map((r, i) => (
                <div key={i} className="row pt-0 gap-2 flex-wrap" style={{ minHeight: 44 }}>
                  <span className="row-main flex items-center gap-2">
                    <Picker variant="plain" label={t('settings.shops.hours.from', { day: name })} value={r.from} options={FROM} onChange={(v) => setRange(d, i, { from: v })} />
                    <span className="t-2">–</span>
                    <Picker variant="plain" label={t('settings.shops.hours.to', { day: name })} value={r.to} options={TO} onChange={(v) => setRange(d, i, { to: v })} />
                  </span>
                  {ranges.length > 1 ? (
                    <button type="button" className="icon-btn" aria-label={t('settings.shops.hours.remove', { day: name })} onClick={() => setDay(d, ranges.filter((_, k) => k !== i))}><IconMinus size={18} /></button>
                  ) : null}
                  {i === ranges.length - 1 && ranges.length < 3 ? (
                    <button type="button" className="icon-btn" aria-label={t('settings.shops.hours.add', { day: name })}
                      onClick={() => setDay(d, [...ranges, { from: r.to === '24:00' ? '23:00' : r.to, to: '24:00' }])}><IconPlus size={18} /></button>
                  ) : null}
                </div>
              ))}
              {d === 'mon' && ranges.length ? (
                <div className="row pt-0" style={{ minHeight: 40 }}>
                  <button type="button" className="btn btn-plain" style={{ minHeight: 36, padding: 0 }}
                    onClick={() => onWeek({ ...week, tue: ranges.map((x) => ({ ...x })), wed: ranges.map((x) => ({ ...x })), thu: ranges.map((x) => ({ ...x })), fri: ranges.map((x) => ({ ...x })) })}>
                    {t('settings.shops.hours.copyMonday')}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        <li className="row-sep">
          <label className="block">
            <span className="field-label">{t('settings.shops.hours.note')}</span>
            <input className="field pt-1" value={note} maxLength={LIMITS.hoursNote} placeholder={t('settings.shops.hours.notePlaceholder')} autoComplete="off"
              onChange={(e) => onNote(e.target.value)} />
          </label>
        </li>
      </ul>
      <p className="inset-group-foot" role={invalid ? 'alert' : undefined} style={invalid ? { color: 'var(--c-error)' } : undefined}>
        {invalid ? t('settings.shops.hours.invalid') : t('settings.shops.hours.foot')}
      </p>
    </section>
  );
}
