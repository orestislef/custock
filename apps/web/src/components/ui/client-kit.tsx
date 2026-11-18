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

// the page behind a sheet never scrolls. with the keyboard down overflow: hidden on the body is
// enough (as it always was). with the keyboard up ios scrolls the layout viewport to the focused
// field and lets touch scrolls through, so for that time the body is pinned at its saved offset,
// any scroll safari still makes is put straight back, and the offset is restored afterwards.
// nested sheets and popovers share the lock, released when the last one closes.
let lockCount = 0;
let lockedOverflow = '';
export function lockPage() {
  if (lockCount++ > 0) return;
  lockedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}
export function unlockPage() {
  if (lockCount === 0 || --lockCount > 0) return;
  unpinPage(true);
  document.body.style.overflow = lockedOverflow;
}

const pinOwners = new Set<object>();
let pinnedScroll = 0;
const keepPinned = () => { if (pinOwners.size > 0 && window.scrollY !== 0) window.scrollTo({ top: 0, behavior: 'instant' }); };
function pinPage(owner: object) {
  if (pinOwners.has(owner)) return;
  pinOwners.add(owner);
  if (pinOwners.size > 1) return;
  pinnedScroll = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed'; b.top = `-${pinnedScroll}px`; b.left = '0'; b.right = '0'; b.width = '100%';
  window.addEventListener('scroll', keepPinned, { passive: true });
  window.visualViewport?.addEventListener('scroll', keepPinned);
}
function unpinPage(all = false, owner?: object) {
  if (all) pinOwners.clear(); else if (owner) pinOwners.delete(owner);
  if (pinOwners.size > 0 || document.body.style.position !== 'fixed') return;
  window.removeEventListener('scroll', keepPinned);
  window.visualViewport?.removeEventListener('scroll', keepPinned);
  const b = document.body.style;
  b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
  window.scrollTo({ top: pinnedScroll, behavior: 'instant' });
}

// a precise pointer (mouse, trackpad): the first field gets the focus as the sheet opens. on touch
// the person taps the field, so the keyboard never slides up while the sheet is still moving.
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
const phoneWidth = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

// keeps a bottom sheet above the on screen keyboard. ios keeps the layout viewport when the
// keyboard opens and only the visual viewport shrinks (and may scroll), so a fixed sheet would sit
// behind the keyboard. the gap goes into a css variable that moves the sheet with a transform and
// caps its height, nothing changes layout, so the viewport events cannot feed back into a loop.
function useKeyboardInset(ref: { current: HTMLDivElement | null }, open: boolean) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = ref.current;
    if (!open || !vv || !el) return;
    let frame = 0;
    let last = '';
    const owner = {};
    // a field that brings up the keyboard (not a switch, a checkbox or a picker wheel)
    const typing = (n: EventTarget | null) => n instanceof HTMLElement && n.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]');
    let wasUp = false;
    const clear = () => {
      el.style.removeProperty('--kb'); el.style.removeProperty('--vvh'); el.removeAttribute('data-kb');
      // right after a tap the keyboard is still on its way (field focused, keyboard not up yet):
      // the page stays pinned meanwhile. once the keyboard was up and went down, typing is over
      const waiting = !wasUp && typing(document.activeElement) && el.contains(document.activeElement);
      wasUp = false;
      if (!waiting) unpinPage(false, owner);
    };
    // safari scrolls the page to a field the moment it is tapped, before the keyboard has moved
    // the visual viewport. so the page is pinned at the touch already, and let go again on blur
    // when no keyboard came up (a hardware keyboard, or the tap went elsewhere)
    const onTouch = (e: Event) => { if (phoneWidth() && typing(e.target)) pinPage(owner); };
    const onBlur = () => { window.setTimeout(() => { if (last === 'down' || last === '') clear(); }, 400); };
    const apply = () => {
      frame = 0;
      if (!phoneWidth()) { clear(); last = ''; return; }
      const layout = document.documentElement.clientHeight;
      const inset = Math.max(0, Math.round(layout - (vv.height + vv.offsetTop)));
      // a gap this tall is the keyboard, not the browser's own bars. with the keyboard down
      // nothing is touched, the sheet behaves as it always did
      const keyboard = inset > 80;
      const key = keyboard ? `${inset}:${Math.round(vv.height)}` : 'down';
      if (key === last) return;
      last = key;
      if (!keyboard) { clear(); return; }
      wasUp = true;
      pinPage(owner);
      el.style.setProperty('--kb', `${inset}px`);
      el.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      el.setAttribute('data-kb', '');
      revealFocused(el);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    // the focused field, kept in view inside the sheet once the keyboard has settled
    const onFocus = () => { schedule(); window.setTimeout(() => revealFocused(el), 350); };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    el.addEventListener('focusin', onFocus);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    el.addEventListener('pointerdown', onTouch, { capture: true, passive: true });
    apply();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', onBlur);
      el.removeEventListener('touchstart', onTouch, { capture: true });
      el.removeEventListener('pointerdown', onTouch, { capture: true });
      unpinPage(false, owner);
    };
  }, [ref, open]);
}

// scrolls the sheet itself (never the page) so the focused field sits above the sticky buttons
function revealFocused(sheet: HTMLElement) {
  const f = document.activeElement as HTMLElement | null;
  if (!f || !sheet.contains(f) || !f.matches('input, textarea, select, [contenteditable="true"]')) return;
  const box = sheet.getBoundingClientRect();
  const footer = sheet.querySelector<HTMLElement>('[data-sheet-footer]');
  const bottom = footer ? footer.getBoundingClientRect().top : box.bottom;
  const r = f.getBoundingClientRect();
  const margin = 12;
  if (r.bottom > bottom - margin) sheet.scrollTop += r.bottom - (bottom - margin);
  else if (r.top < box.top + margin) sheet.scrollTop -= box.top + margin - r.top;
}

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
    const sheet = ref.current;
    if (sheet) {
      if (finePointer()) {
        // a field marked data-autofocus first, else the first control
        (sheet.querySelector<HTMLElement>('[data-autofocus]') ?? sheet.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])'))?.focus({ preventScroll: true });
      } else {
        // touch: the dialog itself takes the focus, so screen readers land in it and no keyboard opens
        sheet.focus({ preventScroll: true });
      }
    }
    lockPage();
    return () => {
      sheetStack.splice(sheetStack.indexOf(me), 1);
      document.removeEventListener('keydown', onKey);
      unlockPage();
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);
  useKeyboardInset(ref, open);

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
        tabIndex={-1}
        aria-label={typeof title === 'string' ? title : undefined}
        style={drag ? { transform: `translate3d(0, calc(${drag}px - var(--kb, 0px)), 0)`, transition: 'none' } : undefined}
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
