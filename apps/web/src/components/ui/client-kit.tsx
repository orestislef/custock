'use client';

// interactive pieces: sheets, toasts, tips, pickers, the language switch, images with a fallback.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { LOCALES, LOCALE_NAMES, type AppLocale } from '@custock/i18n';
import { setLocaleCookie, useLocale, useT } from '@/lib/i18n-client';
import { IconChevronDown, IconClose, IconEye, IconEyeOff, IconGlobe, IconInfo } from './icons';

// ---------------------------------------------------------------- sheet

// open sheets, newest last. only the top one answers escape, keeps the tab focus and takes
// ctrl or cmd + enter as its primary button.
const sheetStack: object[] = [];

export function Sheet({ open, onClose, title, children, footer, error }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; error?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    if (!open) return;
    const me = {};
    sheetStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (sheetStack[sheetStack.length - 1] !== me || !ref.current) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const primary = ref.current.querySelector<HTMLButtonElement>('[data-sheet-footer] .btn-primary:not([disabled])');
        if (primary) { e.preventDefault(); primary.click(); }
        return;
      }
      // keep tab inside the sheet while it is open
      if (e.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      sheetStack.splice(sheetStack.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  // rendered at the end of the body, so a sheet opened from inside another sheet stacks on top
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <div
          className="pt-1 pb-1 touch-none"
          onPointerDown={(e) => { start.current = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => { if (start.current != null) setDrag(Math.max(0, e.clientY - start.current)); }}
          onPointerUp={() => { if (drag > 90) onClose(); start.current = null; setDrag(0); }}
        >
          <div className="grabber" />
          <div className="flex items-center gap-2 px-4 pb-2">
            <h2 className="t-headline flex-1 m-0 text-center pl-11">{title}</h2>
            <button type="button" data-close className="icon-btn" style={{ color: 'var(--c-ink-2)' }} onClick={onClose} aria-label={t('common:action.close')}>
              <span className="inline-grid place-items-center w-[30px] h-[30px] rounded-full" style={{ background: 'var(--c-fill)' }}>
                <IconClose size={16} />
              </span>
            </button>
          </div>
        </div>
        <div className="px-4">{children}</div>
        {footer || error ? (
          <div className="px-4 pt-3" data-sheet-footer>
            {/* errors sit right above the button they belong to, and stay until the next try */}
            {error ? <p className="sheet-error" role="alert">{error}</p> : null}
            {footer ? <div className="sheet-actions">{footer}</div> : null}
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------- toasts

interface ToastItem { id: number; text: ReactNode; action?: { label: string; run: () => void }; ms: number }
const ToastCtx = createContext<(text: ReactNode, action?: ToastItem['action'], ms?: number) => void>(() => {});

// one toast at a time, the rest wait their turn. a toast with an action stays 8 seconds, and the
// clock stops while the pointer or the keyboard focus is on it.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [paused, setPaused] = useState(false);
  const show = useCallback((text: ReactNode, action?: ToastItem['action'], ms?: number) => {
    setQueue((q) => [...q, { id: Date.now() + Math.random(), text, action, ms: Math.max(ms ?? 0, action ? 8000 : 4000) }]);
  }, []);
  const current = queue[0];
  const dismiss = useCallback((id: number) => setQueue((q) => q.filter((x) => x.id !== id)), []);

  useEffect(() => {
    if (!current || paused) return;
    const timer = window.setTimeout(() => dismiss(current.id), current.ms);
    return () => clearTimeout(timer);
  }, [current, paused, dismiss]);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {current ? (
          <div
            key={current.id}
            className="toast"
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <span className="flex-1">{current.text}</span>
            {current.action ? (
              <button type="button" className="btn btn-plain" onClick={() => { current.action!.run(); dismiss(current.id); setPaused(false); }}>
                {current.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- tips, shown once

function subscribeTips(cb: () => void) {
  window.addEventListener('custock-tips', cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener('custock-tips', cb); window.removeEventListener('storage', cb); };
}

export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const t = useT();
  const hidden = useSyncExternalStore(subscribeTips, () => localStorage.getItem(`tip.${id}`) === '1', () => true);
  if (hidden) return null;
  return (
    <div className="tip mb-4">
      <IconInfo size={18} />
      <span className="t-sub flex-1">{children}</span>
      <button
        type="button"
        className="icon-btn -m-2"
        style={{ color: 'var(--c-ink-2)' }}
        aria-label={t('tip.dismiss')}
        onClick={() => { localStorage.setItem(`tip.${id}`, '1'); window.dispatchEvent(new Event('custock-tips')); }}
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- pickers

// the value as readable text with a native select laid over it: the whole pill is the target,
// the system menu opens on every platform, and screen readers get a real combobox.
export function Picker<T extends string>({ value, options, onChange, label, icon, variant = 'filled', disabled, className }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
  icon?: ReactNode; variant?: 'filled' | 'plain' | 'quiet'; disabled?: boolean; className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <span className={`picker ${variant === 'filled' ? 'filled' : variant === 'plain' ? 'plain' : ''} ${className ?? ''}`} aria-disabled={disabled}>
      {icon}
      <span className="truncate">{current}</span>
      <IconChevronDown size={14} />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

// ---------------------------------------------------------------- sideways rows

// a row that scrolls sideways and fades at the edge where there is more to see, so it reads as
// scrollable. the fade follows the scroll position and the width.
export function FadeRow({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  return (
    <div ref={ref} className={`fade-x ${className ?? ''}`} data-start={edges.start ? '' : undefined} data-end={edges.end ? '' : undefined} role="group" aria-label={label}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- password field

// a password input with a trailing show or hide button. the button never takes the focus from
// the field, and the caret stays where it was when the text is revealed or hidden again.
export function PasswordField({ className = 'field', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const toggle = () => {
    const el = ref.current;
    const focused = !!el && document.activeElement === el;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setShown((v) => !v);
    if (focused && start !== null) requestAnimationFrame(() => el!.setSelectionRange(start, end ?? start));
  };
  return (
    <span className="password-field">
      <input ref={ref} {...props} className={className} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="password-toggle"
        aria-label={t('password.show')}
        aria-pressed={shown}
        onPointerDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        {shown ? <IconEyeOff size={20} /> : <IconEye size={20} />}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- language switch

export function LocaleSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const t = useT();
  return (
    <Picker
      variant="quiet"
      className="min-h-[44px]"
      label={t('locale.label')}
      icon={<IconGlobe size={18} />}
      value={locale}
      onChange={(l: AppLocale) => { setLocaleCookie(l); router.refresh(); }}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
    />
  );
}

// ---------------------------------------------------------------- keyboard shortcuts

// "/" focuses the page search, ctrl or cmd + n runs the page's new item action
export function useShortcuts({ search, create }: { search?: () => void; create?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && search) { e.preventDefault(); search(); return; }
      if ((e.key === 'n' || e.key === 'N') && (e.metaKey || e.ctrlKey) && !e.shiftKey && create) { e.preventDefault(); create(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [search, create]);
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// ---------------------------------------------------------------- product images with a fallback tile

// fallback replaces the letter, for example with the product's category icon
export function Photo({ src, alt, className, size, rounded = 9, fallback }: { src: string | null | undefined; alt: string; className?: string; size?: number; rounded?: number; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const letter = alt.trim()[0]?.toUpperCase() ?? '';
  if ((!src || failed) && fallback) return <>{fallback}</>;
  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid place-items-center flex-none t-display font-semibold ${className ?? ''}`}
        style={{ width: size, height: size, borderRadius: rounded, background: 'var(--c-fill)', color: 'var(--c-ink-2)', fontSize: (size ?? 44) * 0.42 }}
      >
        {letter}
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size ?? 500}
      height={size ?? 375}
      className={`object-cover flex-none ${className ?? ''}`}
      style={{ borderRadius: rounded, ...(size ? { width: size, height: size } : {}) }}
      onError={() => setFailed(true)}
    />
  );
}
