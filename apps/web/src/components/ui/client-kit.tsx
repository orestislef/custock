'use client';

// interactive pieces: sheets, toasts, tips, the language switch, images with a fallback.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LOCALES, LOCALE_NAMES, type AppLocale } from '@custock/i18n';
import { setLocaleCookie, useLocale, useT } from '@/lib/i18n-client';
import { IconClose, IconGlobe } from './icons';

// ---------------------------------------------------------------- sheet

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
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
        {footer ? <div className="px-4 pt-3">{footer}</div> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- toasts

interface ToastItem { id: number; text: ReactNode; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: ReactNode, action?: ToastItem['action'], ms?: number) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: ReactNode, action?: ToastItem['action'], ms = 4000) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-1), { id, text, action }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {items.slice(-1).map((i) => (
          <div key={i.id} className="toast">
            <span className="flex-1">{i.text}</span>
            {i.action ? (
              <button type="button" className="btn btn-plain" onClick={() => { i.action!.run(); setItems((x) => x.filter((y) => y.id !== i.id)); }}>
                {i.action.label}
              </button>
            ) : null}
          </div>
        ))}
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
      <span className="t-sub flex-1 pt-0.5">{children}</span>
      <button
        type="button"
        className="icon-btn -m-2"
        aria-label={t('tip.dismiss')}
        onClick={() => { localStorage.setItem(`tip.${id}`, '1'); window.dispatchEvent(new Event('custock-tips')); }}
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- language switch

export function LocaleSwitch({ compact }: { compact?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useT();
  return (
    <label className={`inline-flex items-center gap-1.5 ${compact ? '' : 'min-h-[44px]'}`} style={{ color: 'var(--c-ink-2)' }}>
      <IconGlobe size={18} />
      <span className="sr-only">{t('locale.label')}</span>
      <select
        className="t-sub bg-transparent border-0 outline-none cursor-pointer"
        style={{ color: 'var(--c-ink-2)' }}
        value={locale}
        onChange={(e) => { setLocaleCookie(e.target.value as AppLocale); router.refresh(); }}
      >
        {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- product images with a fallback tile

export function Photo({ src, alt, className, size, rounded = 9 }: { src: string | null | undefined; alt: string; className?: string; size?: number; rounded?: number }) {
  const [failed, setFailed] = useState(false);
  const letter = alt.trim()[0]?.toUpperCase() ?? '';
  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid place-items-center flex-none t-display font-semibold ${className ?? ''}`}
        style={{ width: size, height: size, borderRadius: rounded, background: 'var(--c-accent-tint)', color: 'var(--c-accent)', fontSize: (size ?? 44) * 0.42 }}
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
