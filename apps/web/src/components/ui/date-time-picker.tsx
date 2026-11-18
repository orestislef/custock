'use client';

// the app's own date and time picker, in place of the browser's. a field that shows the value in
// the person's language and the business's time zone; it opens a calendar (and hour and minute
// columns) in a popover on wide screens and in a bottom sheet on phones. everything follows the
// language chosen in custock, never the browser's.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '@/components/ui/client-kit';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconClose } from '@/components/ui/icons';
import { intlLocale } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';
import { useMedia } from '@/lib/use-media';
import { addDays, addMonths, dayInstant, dayKey, daysInMonth, fromWall, sameZone, toWall, weekdayMon, zoneName, type Wall } from '@/lib/zoned';

type Day = { y: number; m: number; d: number };

export interface DateTimePickerProps {
  value: number | null;
  onChange: (ms: number | null) => void;
  // the business's time zone, the picker shows and picks wall clock time there
  timeZone: string;
  label: string;
  mode?: 'datetime' | 'date';
  // date mode: the value is the first or the last moment of the picked day
  dayEdge?: 'start' | 'end';
  // 'row' sits in an inset list with the label on the left, 'field' fills the row
  variant?: 'row' | 'field';
  optional?: boolean;
  // only moments from now on can be picked (scheduling)
  future?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  minuteStep?: number;
  // quick choices like "In 1 hour", shown with future datetime pickers
  quickPicks?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function roundUp(w: Wall, step: number): Wall {
  const extra = (step - (w.min % step)) % step;
  if (!extra) return w;
  const total = w.h * 60 + w.min + extra;
  if (total < 24 * 60) return { ...w, h: Math.floor(total / 60), min: total % 60 };
  const next = addDays(w, 1);
  return { ...next, h: 0, min: total - 24 * 60 };
}

export function DateTimePicker(p: DateTimePickerProps) {
  const {
    value, onChange, timeZone: tz, label, mode = 'datetime', dayEdge = 'start', variant = 'field',
    optional = false, future = false, min, max, placeholder, minuteStep = 5, quickPicks = false,
  } = p;
  const locale = useLocale();
  const il = intlLocale(locale);
  const t = useT();
  const wide = useMedia('(min-width: 768px)');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Wall | null>(null);
  // "now" as of opening, so the limits do not move while the picker is open
  const [openedAt, setOpenedAt] = useState(0);

  const fmt = useMemo(() => new Intl.DateTimeFormat(il, mode === 'date'
    ? { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [il, tz, mode]);

  const lower = useMemo(() => {
    const limits = [min, future && openedAt ? openedAt : undefined].filter((x): x is number => x != null);
    return limits.length ? Math.max(...limits) : null;
  }, [min, future, openedAt]);

  const toMs = useCallback((w: Wall): number => {
    if (mode === 'datetime') return fromWall(w, tz);
    if (dayEdge === 'end') return fromWall({ ...addDays(w, 1), h: 0, min: 0 }, tz) - 1;
    return fromWall({ ...w, h: 0, min: 0 }, tz);
  }, [mode, dayEdge, tz]);

  const startDraft = (now: number): Wall => {
    if (value != null) {
      const w = toWall(value, tz);
      return mode === 'datetime' ? { ...w, min: Math.round(w.min / minuteStep) * minuteStep >= 60 ? 60 - minuteStep : Math.round(w.min / minuteStep) * minuteStep } : w;
    }
    const base = toWall(Math.max(now + (future && mode === 'datetime' ? 60 * 60_000 : 0), min ?? 0), tz);
    return mode === 'datetime' ? roundUp(base, minuteStep) : base;
  };

  const openPicker = () => { const now = Date.now(); setOpenedAt(now); setDraft(startDraft(now)); setOpen(true); };
  const close = (commit: boolean) => {
    if (commit && draft) {
      const ms = toMs(draft);
      if (allowed(ms)) onChange(ms);
    }
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  function allowed(ms: number): boolean {
    if (lower != null && ms < (mode === 'date' && dayEdge === 'end' ? lower : lower - 60_000)) return false;
    if (max != null && ms > max) return false;
    return true;
  }

  const shown = value != null ? fmt.format(value) : null;
  const empty = placeholder ?? (mode === 'date' ? t('picker.chooseDate') : t('picker.choose'));

  const trigger = (
    <span className={variant === 'row' ? 'dtp-trigger-row' : 'dtp-trigger-field'}>
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'row' ? 'dtp-value' : 'dtp-field'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${shown ?? empty}`}
        onClick={openPicker}
      >
        {variant === 'field' ? <IconCalendar size={20} className="dtp-icon" /> : null}
        <span className={shown ? 'dtp-text' : 'dtp-text dtp-placeholder'}>{shown ?? empty}</span>
      </button>
      {optional && value != null ? (
        <button type="button" className="dtp-clear" aria-label={t('picker.clear', { label })} onClick={() => onChange(null)}>
          <IconClose size={14} />
        </button>
      ) : null}
    </span>
  );

  const body = open && draft ? (
    <PickerBody
      draft={draft}
      setDraft={setDraft}
      now={openedAt}
      mode={mode}
      tz={tz}
      il={il}
      minuteStep={minuteStep}
      lower={lower}
      max={max ?? null}
      toMs={toMs}
      allowed={allowed}
      quick={quickPicks && future && mode === 'datetime'}
      onQuick={(w) => { const ms = toMs(w); if (allowed(ms)) onChange(ms); setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }}
      onDone={() => close(true)}
      onCancel={() => close(false)}
      label={label}
      wide={wide}
    />
  ) : null;

  return (
    <>
      {variant === 'row' ? (
        <div className="row dtp-row">
          <span className="row-main row-title">{label}</span>
          {trigger}
        </div>
      ) : trigger}
      {open && wide ? (
        <Popover anchor={triggerRef} onDismiss={() => close(true)} onEscape={() => close(false)} label={label}>{body}</Popover>
      ) : null}
      {!wide ? (
        <Sheet open={open} onClose={() => close(false)} title={label}
          footer={<>
            <button type="button" className="btn btn-gray" onClick={() => close(false)}>{t('common:action.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={!draft || !allowed(toMs(draft))} onClick={() => close(true)}>{t('common:action.done')}</button>
          </>}>
          {body}
        </Sheet>
      ) : null}
    </>
  );
}

export function DatePicker(p: Omit<DateTimePickerProps, 'mode' | 'quickPicks' | 'minuteStep'>) {
  return <DateTimePicker {...p} mode="date" />;
}

// ---------------------------------------------------------------- the open picker

function PickerBody(props: {
  draft: Wall; setDraft: (w: Wall) => void; now: number; mode: 'datetime' | 'date'; tz: string; il: string; minuteStep: number;
  lower: number | null; max: number | null; toMs: (w: Wall) => number; allowed: (ms: number) => boolean;
  quick: boolean; onQuick: (w: Wall) => void; onDone: () => void; onCancel: () => void; label: string; wide: boolean;
}) {
  const { draft, setDraft, now, mode, tz, il, minuteStep, lower, max, toMs, allowed, quick, onQuick, onDone, onCancel, wide } = props;
  const t = useT();
  const [view, setView] = useState<{ y: number; m: number }>({ y: draft.y, m: draft.m });
  const [focus, setFocus] = useState<Day>({ y: draft.y, m: draft.m, d: draft.d });
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const today = toWall(now, tz);
  const lowDay = lower != null ? toWall(lower, tz) : null;
  const highDay = max != null ? toWall(max, tz) : null;
  const dayOff = (x: Day) => (lowDay != null && dayKey(x) < dayKey(lowDay)) || (highDay != null && dayKey(x) > dayKey(highDay));

  const monthTitle = useMemo(() => {
    const s = new Intl.DateTimeFormat(il, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(dayInstant({ y: view.y, m: view.m, d: 15 }));
    return s.charAt(0).toLocaleUpperCase(il) + s.slice(1);
  }, [il, view]);
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(il, { timeZone: 'UTC', weekday: 'short' });
    const long = new Intl.DateTimeFormat(il, { timeZone: 'UTC', weekday: 'long' });
    // 2 november 2026 is a monday
    return Array.from({ length: 7 }, (_, i) => ({ short: short.format(dayInstant({ y: 2026, m: 11, d: 2 + i })), long: long.format(dayInstant({ y: 2026, m: 11, d: 2 + i })) }));
  }, [il]);
  const dayLabel = useMemo(() => new Intl.DateTimeFormat(il, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), [il]);

  const first = weekdayMon(view.y, view.m, 1);
  const count = daysInMonth(view.y, view.m);
  const cells: (Day | null)[] = [...Array.from({ length: first }, () => null), ...Array.from({ length: count }, (_, i) => ({ y: view.y, m: view.m, d: i + 1 }))];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const prevMonth = addMonths(view.y, view.m, -1);
  const nextMonth = addMonths(view.y, view.m, 1);
  const prevOff = lowDay != null && dayKey({ ...prevMonth, d: daysInMonth(prevMonth.y, prevMonth.m) }) < dayKey(lowDay);
  const nextOff = highDay != null && dayKey({ ...nextMonth, d: 1 }) > dayKey(highDay);

  const pick = (x: Day) => {
    if (dayOff(x)) return;
    setFocus(x);
    let w: Wall = { ...draft, y: x.y, m: x.m, d: x.d };
    // moving to today with a time already gone: the first free time
    if (mode === 'datetime' && lower != null && !allowed(toMs(w))) w = roundUp({ ...toWall(lower, tz), y: x.y, m: x.m, d: x.d }, minuteStep);
    setDraft(w);
  };

  const moveFocus = (x: Day) => {
    moved.current = true;
    setFocus(x);
    if (x.y !== view.y || x.m !== view.m) setView({ y: x.y, m: x.m });
  };

  const onGridKey = (e: ReactKeyboardEvent) => {
    const k = e.key;
    let next: Day | null = null;
    if (k === 'ArrowLeft') next = addDays(focus, -1);
    else if (k === 'ArrowRight') next = addDays(focus, 1);
    else if (k === 'ArrowUp') next = addDays(focus, -7);
    else if (k === 'ArrowDown') next = addDays(focus, 7);
    else if (k === 'Home') next = addDays(focus, -weekdayMon(focus.y, focus.m, focus.d));
    else if (k === 'End') next = addDays(focus, 6 - weekdayMon(focus.y, focus.m, focus.d));
    else if (k === 'PageUp' || k === 'PageDown') {
      const mm = addMonths(focus.y, focus.m, (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1));
      next = { ...mm, d: Math.min(focus.d, daysInMonth(mm.y, mm.m)) };
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      pick(focus);
      return;
    }
    if (next) { e.preventDefault(); moveFocus(next); }
  };

  // keyboard focus follows the roving day
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${dayKey(focus)}"]`)?.focus();
  }, [focus, view]);

  // the chosen day gets focus when the picker opens
  useEffect(() => {
    const id = window.setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${dayKey(focus)}"]`)?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const timeFmt = useMemo(() => new Intl.DateTimeFormat(il, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [il]);
  const quickList = useMemo(() => {
    if (!quick) return [];
    const here = toWall(now, tz);
    const inHour = roundUp(toWall(now + 60 * 60_000, tz), minuteStep);
    const tomorrow = { ...addDays(here, 1), h: 9, min: 0 };
    const toMon = (7 - weekdayMon(here.y, here.m, here.d)) % 7 || 7;
    const monday = { ...addDays(here, toMon), h: 9, min: 0 };
    const at9 = timeFmt.format(Date.UTC(2026, 0, 1, 9, 0));
    const dayName = new Intl.DateTimeFormat(il, { timeZone: 'UTC', weekday: 'long' }).format(dayInstant(monday));
    const list: { key: string; label: string; w: Wall }[] = [
      { key: 'hour', label: t('picker.inHour'), w: inHour },
      { key: 'tomorrow', label: t('picker.tomorrowAt', { time: at9 }), w: tomorrow },
    ];
    if (toMon > 1) list.push({ key: 'monday', label: t('picker.dayAt', { day: dayName.charAt(0).toLocaleUpperCase(il) + dayName.slice(1), time: at9 }), w: monday });
    return list.filter((q) => allowed(toMs(q.w)));
  }, [quick, now, tz, minuteStep, il, timeFmt, t, allowed, toMs]);

  const showZone = !sameZone(tz);

  return (
    <div className={`dtp-body${mode === 'datetime' ? ' dtp-with-time' : ''}${wide ? ' dtp-wide' : ''}`}>
      {quickList.length ? (
        <div className="dtp-quick" role="group" aria-label={t('picker.quick')}>
          {quickList.map((q) => <button key={q.key} type="button" className="chip" onClick={() => onQuick(q.w)}>{q.label}</button>)}
        </div>
      ) : null}
      <div className="dtp-main">
        <div className="dtp-cal">
          <div className="dtp-head">
            <h3 className="dtp-month" aria-live="polite">{monthTitle}</h3>
            <button type="button" className="dtp-nav" aria-label={t('picker.prevMonth')} disabled={prevOff} onClick={() => setView(prevMonth)}><IconChevronLeft size={20} /></button>
            <button type="button" className="dtp-nav" aria-label={t('picker.nextMonth')} disabled={nextOff} onClick={() => setView(nextMonth)}><IconChevronRight size={20} /></button>
          </div>
          <div ref={gridRef} role="grid" aria-label={monthTitle} className="dtp-grid" onKeyDown={onGridKey}>
            <div role="row" className="dtp-week dtp-weekdays">
              {weekdays.map((w) => <span key={w.long} role="columnheader" aria-label={w.long} className="dtp-wd">{w.short}</span>)}
            </div>
            {weeks.map((week, wi) => (
              <div role="row" className="dtp-week" key={wi}>
                {week.map((x, di) => {
                  if (!x) return <span role="gridcell" key={di} className="dtp-cell" />;
                  const k = dayKey(x);
                  const selected = k === dayKey(draft);
                  const isToday = k === dayKey(today);
                  const off = dayOff(x);
                  const inView = focus.y === view.y && focus.m === view.m;
                  const tabbable = inView ? k === dayKey(focus) : x.d === 1;
                  return (
                    <span role="gridcell" key={di} className="dtp-cell" aria-selected={selected}>
                      <button
                        type="button"
                        data-day={k}
                        tabIndex={tabbable ? 0 : -1}
                        className={`dtp-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                        aria-label={`${dayLabel.format(dayInstant(x))}${isToday ? `, ${t('picker.today')}` : ''}`}
                        aria-pressed={selected}
                        aria-disabled={off || undefined}
                        disabled={off}
                        onClick={() => pick(x)}
                        onFocus={() => { if (k !== dayKey(focus)) setFocus(x); }}
                      >
                        {x.d}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {mode === 'datetime' ? (
          <TimeColumns draft={draft} setDraft={setDraft} step={minuteStep} isAllowed={(w) => allowed(toMs(w))} />
        ) : null}
      </div>
      {showZone ? <p className="dtp-zone">{t('picker.zone', { zone: zoneName(tz, il) })}</p> : null}
      {wide ? (
        <div className="sheet-actions dtp-actions">
          <button type="button" className="btn btn-gray" onClick={onCancel}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={!allowed(toMs(draft))} onClick={onDone}>{t('common:action.done')}</button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- hour and minute columns

function TimeColumns({ draft, setDraft, step, isAllowed }: { draft: Wall; setDraft: (w: Wall) => void; step: number; isAllowed: (w: Wall) => boolean }) {
  const t = useT();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 / step }, (_, i) => i * step);
  return (
    <div className="dtp-time">
      <Column label={t('picker.hour')} items={hours} value={draft.h}
        isOff={(h) => !isAllowed({ ...draft, h, min: 60 - step }) }
        onPick={(h) => {
          let w = { ...draft, h };
          if (!isAllowed(w)) w = { ...w, min: minutes.find((m) => isAllowed({ ...w, min: m })) ?? w.min };
          setDraft(w);
        }} />
      <span className="dtp-colon" aria-hidden="true">:</span>
      <Column label={t('picker.minute')} items={minutes} value={draft.min}
        isOff={(m) => !isAllowed({ ...draft, min: m })}
        onPick={(m) => setDraft({ ...draft, min: m })} />
    </div>
  );
}

const ROW = 40;

function Column({ label, items, value, onPick, isOff }: { label: string; items: number[]; value: number; onPick: (v: number) => void; isOff: (v: number) => boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number | null>(null);
  const fromScroll = useRef(false);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');

  // the chosen value sits in the middle band
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (fromScroll.current) { fromScroll.current = false; return; }
    const i = items.indexOf(value);
    if (i >= 0) el.scrollTo({ top: i * ROW, behavior: reduced || !el.dataset.ready ? 'auto' : 'smooth' });
    el.dataset.ready = '1';
  }, [value, items, reduced]);

  const onScroll = () => {
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
      const v = items[i]!;
      if (v !== value && !isOff(v)) { fromScroll.current = true; onPick(v); }
    }, 120);
  };

  const onKey = (e: ReactKeyboardEvent) => {
    const i = items.indexOf(value);
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j >= 0) {
      e.preventDefault();
      // skip times that cannot be picked
      const dir = j >= i ? 1 : -1;
      while (j >= 0 && j < items.length && isOff(items[j]!)) j += dir;
      if (j >= 0 && j < items.length) onPick(items[j]!);
    }
  };

  const id = `dtp-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <div className="dtp-col-wrap">
      <div
        ref={ref}
        className="dtp-col"
        role="listbox"
        aria-label={label}
        tabIndex={0}
        aria-activedescendant={`${id}-${value}`}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {items.map((v) => {
          const off = isOff(v);
          return (
            <div
              key={v}
              id={`${id}-${v}`}
              role="option"
              aria-selected={v === value}
              aria-disabled={off || undefined}
              className={`dtp-opt${v === value ? ' is-selected' : ''}${off ? ' is-off' : ''}`}
              onClick={() => { if (!off) onPick(v); }}
            >
              {pad(v)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the popover on wide screens

function Popover({ anchor, onDismiss, onEscape, label, children }: { anchor: React.RefObject<HTMLElement | null>; onDismiss: () => void; onEscape: () => void; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth, h = el.offsetHeight, gap = 8, m = 12;
      const below = window.innerHeight - a.bottom - gap - m;
      const up = below < h && a.top - gap - m > below;
      const top = up ? Math.max(m, a.top - gap - h) : Math.min(a.bottom + gap, window.innerHeight - m - h);
      const left = Math.min(Math.max(m, a.left), window.innerWidth - m - w);
      setPos({ top, left, up });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [anchor, onDismiss, onEscape]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className={`dtp-pop${pos?.up ? ' is-up' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
