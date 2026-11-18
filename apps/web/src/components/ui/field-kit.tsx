'use client';

// small pieces every form uses: the error line under a field, a character counter that shows near
// the limit, and FormNav, which makes the keyboard's action key do the right thing on phones.

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { emailProblem, normalizeEmail, type FieldError } from '@custock/core';
import { fieldMessage, type FieldKind } from '@/lib/fields';
import { useT } from '@/lib/i18n-client';

export function FieldMessage({ id, kind, error, params }: { id: string; kind: FieldKind; error: FieldError | string | null | undefined; params?: Record<string, unknown> }) {
  const t = useT();
  const text = fieldMessage(t as unknown as (key: string, opts: Record<string, unknown>) => string, kind, error, params);
  if (!text) return null;
  return <p id={id} className="field-msg" role="alert">{text}</p>;
}

// "120 of 200" shown once a text gets close to its limit, so nobody types into a wall
export function Counter({ value, max, from = 0.8 }: { value: string; max: number; from?: number }) {
  const t = useT();
  const used = [...value].length;
  if (used < max * from) return null;
  return <p className={`field-count${used > max ? ' over' : ''}`} aria-live="polite">{t('common:field.counter', { used, max })}</p>;
}

const FOCUSABLE = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])';

function fields(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

// wraps a form's fields. every single line field gets enterkeyhint "next" except the last one,
// which gets `last` ("done", "go", "send" or "search"). Enter moves to the next field, and on the
// last one calls onDone, which runs the form's own checks, so a half filled form is never sent
// by accident. Enter in a textarea makes a new line as usual.
export function FormNav({ children, onDone, last = 'done', className }: { children: ReactNode; onDone?: () => void; last?: 'done' | 'go' | 'send' | 'search' | 'next'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const list = fields(root);
    list.forEach((el, i) => {
      if (el.tagName === 'TEXTAREA' || el.dataset.enterHint === 'own') return;
      el.setAttribute('enterkeyhint', i === list.length - 1 ? last : 'next');
    });
  });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
    const root = ref.current;
    if (!root) return;
    const list = fields(root);
    const at = list.indexOf(target);
    if (at < 0) return;
    e.preventDefault();
    const next = list[at + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement && ['text', 'email', 'tel', 'search', 'url', 'password', ''].includes(next.type)) next.select();
    } else {
      onDone?.();
    }
  };
  return <div ref={ref} onKeyDown={onKeyDown} className={className}>{children}</div>;
}

// an email box: the right keyboard, trimmed and lowercased when it loses focus, and its own error
// line once the person has left it with something that is not an email
export function EmailInput({ value, onChange, id, className = 'field pt-1', autoComplete = 'off', enterKeyHint = 'next', autoFocus, required = true, label }: {
  value: string; onChange: (v: string) => void; id?: string; className?: string; autoComplete?: string;
  enterKeyHint?: 'next' | 'done' | 'go' | 'send'; autoFocus?: boolean; required?: boolean; label?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const [error, setError] = useState<FieldError | null>(null);
  return (
    <>
      <input id={fieldId} className={className} type="email" inputMode="email" autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        enterKeyHint={enterKeyHint} maxLength={254} value={value} autoFocus={autoFocus} aria-label={label}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${fieldId}-error` : undefined}
        onChange={(e) => { onChange(e.target.value); if (error && !emailProblem(e.target.value, { required })) setError(null); }}
        onBlur={() => { const v = normalizeEmail(value); if (v !== value) onChange(v); setError(v ? emailProblem(v, { required }) : null); }} />
      <FieldMessage id={`${fieldId}-error`} kind="email" error={error} />
    </>
  );
}
