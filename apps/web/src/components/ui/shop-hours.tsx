'use client';

// a shop's opening hours for customers: "Open now · until 20:00" or "Closed · opens Monday at
// 15:00", worked out in the shop's time zone, and the week in short ("Mon–Fri 15:00–20:00").
// the live state is only drawn in the browser (after the page shows), so the server's clock never
// disagrees with the visitor's, and it moves on by itself every minute.

import { useEffect, useState } from 'react';
import { groupHours, openState, WEEKDAYS, type OpenState, type ShopHours, type Weekday } from '@custock/core';
import { useLocale, useT } from '@/lib/i18n-client';
import { intlLocale } from '@/lib/format';

// 1 january 2024 was a monday: weekday names in the reader's language, without a calendar library
const dayName = (d: Weekday, locale: string, style: 'long' | 'short') =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(d))));

export function OpenNow({ hours, timeZone, className }: { hours: ShopHours | null | undefined; timeZone: string; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<OpenState | null | undefined>(undefined);
  useEffect(() => {
    const tick = () => setState(openState(hours, Date.now(), timeZone));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [hours, timeZone]);
  if (!state) return null;
  const text = state.open
    ? t('common:hours.openNow', { time: state.until })
    : state.opens.in === 'today' ? t('common:hours.opensToday', { time: state.opens.at })
      : state.opens.in === 'tomorrow' ? t('common:hours.opensTomorrow', { time: state.opens.at })
        : t('common:hours.opensDay', { day: dayName(state.opens.day, locale, 'long'), time: state.opens.at });
  return <span className={className ?? 't-sub'} style={{ color: state.open ? 'var(--c-success)' : 'var(--c-ink-2)' }} data-open={state.open ? 'true' : 'false'}>{text}</span>;
}

// the week in short: days next to each other with the same hours on one line
export function HoursList({ hours }: { hours: ShopHours }) {
  const t = useT();
  const locale = useLocale();
  const groups = groupHours(hours);
  return (
    <div className="t-sub" style={{ color: 'var(--c-ink-2)' }}>
      <dl className="m-0 grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'auto 1fr' }}>
        {groups.map((g) => (
          <div key={g.from} className="contents">
            <dt>{g.from === g.to ? dayName(g.from, locale, 'short') : `${dayName(g.from, locale, 'short')}–${dayName(g.to, locale, 'short')}`}</dt>
            <dd className="m-0 tnum">{g.ranges.length ? g.ranges.map((r) => `${r.from}–${r.to}`).join(', ') : t('common:hours.closed')}</dd>
          </div>
        ))}
      </dl>
      {hours.note ? <p className="m-0 mt-1">{hours.note}</p> : null}
    </div>
  );
}
