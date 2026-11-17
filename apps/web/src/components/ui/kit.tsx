// small building blocks: inset grouped lists, rows, switches, segmented controls, badges,
// empty states and the "why not" line. no state here, so they work in server components too.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconChevronRight, IconHalf, IconLock, IconSlash, IconTruck, IconWarning } from './icons';

// a group is a real list (ul role=list), each Row inside renders as its li
export function Group({ title, footer, children, className }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`inset-group ${className ?? ''}`}>
      {title ? <h2 className="inset-group-head">{title}</h2> : null}
      <ul className="list" role="list">{wrapRows(children)}</ul>
      {footer ? <p className="inset-group-foot">{footer}</p> : null}
    </section>
  );
}

function wrapRows(children: ReactNode): ReactNode {
  const items = Array.isArray(children) ? children.flat(3) : [children];
  return items.filter((c) => c != null && c !== false).map((c, i) => {
    const key = (c as { key?: string | null })?.key ?? i;
    return <li key={key}>{c}</li>;
  });
}

interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  iconInset?: boolean;
  disabled?: boolean;
  label?: string;
}

export function Row({ title, subtitle, value, leading, trailing, href, onClick, chevron, iconInset, disabled, label }: RowProps) {
  const inner = (
    <>
      {leading}
      <span className="row-main">
        <span className="row-title block">{title}</span>
        {subtitle ? <span className="row-sub block">{subtitle}</span> : null}
      </span>
      {value != null ? <span className="row-value tnum">{value}</span> : null}
      {trailing}
      {(chevron ?? Boolean(href || onClick)) ? <IconChevronRight size={16} className="chev" /> : null}
    </>
  );
  const cls = `row ${iconInset || leading ? 'has-icon' : ''}`;
  if (href && !disabled) return <Link className={cls} href={href} aria-label={label}>{inner}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={label}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

export function IconTile({ children, tone }: { children: ReactNode; tone?: 'neg' | 'ok' }) {
  return <span className={`icon-tile ${tone ?? ''}`}>{children}</span>;
}

export type StockState = 'in' | 'few' | 'out' | 'negative' | 'onTheWay';

export function stockState(onHand: number, reorderPoint: number | null, threshold = 3): StockState {
  if (onHand < 0) return 'negative';
  if (onHand === 0) return 'out';
  if (onHand <= (reorderPoint ?? threshold)) return 'few';
  return 'in';
}

// color plus icon plus word, never color alone
export function StockBadge({ state, label }: { state: StockState; label: string }) {
  if (state === 'in') return null;
  const map = {
    few: ['badge-few', <IconHalf key="i" size={14} />],
    out: ['badge-out', <IconSlash key="i" size={14} />],
    negative: ['badge-neg', <IconWarning key="i" size={14} />],
    onTheWay: ['badge-info', <IconTruck key="i" size={14} />],
  } as const;
  const [cls, icon] = map[state];
  return <span className={`badge ${cls}`}>{icon}{label}</span>;
}

export function Why({ children }: { children: ReactNode }) {
  return <span className="why"><IconLock size={13} />{children}</span>;
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <p className="t-title3 m-0">{title}</p>
      {body ? <p className="t-sub t-2 mt-2 mb-0">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, name }: { checked: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean; name?: string }) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        name={name}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="track" />
      <span className="knob" />
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, doneLabel }: { value: T; options: { value: T; label: string; done?: boolean }[]; onChange: (v: T) => void; label: string; doneLabel?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.done ? (
            <>
              <span aria-hidden="true" className="inline-block rounded-full ml-1.5 align-middle" style={{ width: 6, height: 6, background: 'var(--c-accent)' }} />
              {doneLabel ? <span className="sr-only">{doneLabel}</span> : null}
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// a scrollable row of choices, for options that do not fit a segmented control on a phone
export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="scroll-x flex gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

// avatar colors carry no meaning, so the brand accent is not one of them. white text passes on each
const AVATAR = ['#2F5BC8', '#8F5E0F', '#5E7D3A', '#17706F', '#7B4FA0', '#6B7280'];

export function Avatar({ name, size = 36 }: { name: string | null | undefined; size?: number }) {
  const n = name ?? '';
  const color = AVATAR[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span
      aria-hidden="true"
      className="inline-grid place-items-center rounded-full text-white font-semibold flex-none"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials(n)}
    </span>
  );
}

// a true minus sign for quantities that went down
export function signed(n: number, text: string): string {
  return n > 0 ? `+${text}` : n < 0 ? `−${text.replace(/^[-−]/, '')}` : text;
}
