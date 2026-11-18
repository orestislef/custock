'use client';

// form fields with the shared rules from @custock/core/validate. each hook keeps what the person
// typed, checks it on blur and on submit, and gives back the clean value. errors are codes with
// texts in common.json field.* (and field.<kind>.* when a kind says it better).

import { useCallback, useId, useState } from 'react';
import {
  cleanLine, cleanText, checkText, emailProblem, formatMoneyInput, formatQtyInput, normalizeEmail, normalizeOtp,
  parseBarcodeInput, parseIntInput, parseMoneyInput, parsePhone, parseQtyInput, passwordProblem,
  type FieldError, type Parsed, type QtyUom,
} from '@custock/core';

// any i18next t function
type TFn = (key: string, opts: Record<string, unknown>) => string;

export type FieldKind = 'money' | 'qty' | 'int' | 'email' | 'phone' | 'password' | 'otp' | 'slug' | 'barcode' | 'text' | 'line' | 'url';

// the message for a field error, in the person's language
export function fieldMessage(t: TFn, kind: FieldKind, error: FieldError | string | null | undefined, params: Record<string, unknown> = {}): string | null {
  if (!error) return null;
  const generic = t(`common:field.${error}`, { ...params, defaultValue: t('common:field.invalid', {}) });
  return t(`common:field.${kind}.${error}`, { ...params, defaultValue: generic });
}

export const decimalExample = (locale: string, decimals = 2) => {
  const sep = locale === 'en' ? '.' : ',';
  return decimals === 2 ? `9${sep}90` : decimals === 3 ? `1${sep}5` : '2';
};

interface FieldState<T> {
  text: string;
  setText: (v: string) => void;
  error: FieldError | null;
  setError: (e: FieldError | null) => void;
  // checks now, shows the error, and gives the clean value (undefined when it is not valid)
  check: () => T | undefined;
  id: string;
  errorId: string;
  bind: {
    id: string;
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  };
}

function useField<T>(initial: string, parse: (text: string) => Parsed<T>, format?: (value: T) => string): FieldState<T> {
  const id = useId();
  const errorId = `${id}-error`;
  const [text, setTextRaw] = useState(initial);
  const [error, setError] = useState<FieldError | null>(null);
  const setText = useCallback((v: string) => {
    setTextRaw(v);
    // the error goes away as soon as the person fixes it, it never appears while typing
    setError((e) => (e && parse(v).ok ? null : e));
  }, [parse]);
  const check = (): T | undefined => {
    const r = parse(text);
    if (!r.ok) {
      setError(r.error);
      return undefined;
    }
    setError(null);
    if (format) {
      const shown = format(r.value);
      if (shown !== text) setTextRaw(shown);
    }
    return r.value;
  };
  return {
    text, setText, error, setError, check, id, errorId,
    bind: {
      id, value: text,
      onChange: (e) => setText(e.target.value),
      onBlur: () => { if (text.trim() || error) check(); },
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined,
    },
  };
}

const okv = <T,>(value: T): Parsed<T> => ({ ok: true, value });

// a price or cost, in minor units. empty is null unless required
export function useMoneyField(initialMinor: number | null | undefined, locale: string, opts: { required?: boolean; allowNegative?: boolean } = {}) {
  const parse = useCallback((s: string): Parsed<number | null> => (!s.trim() ? (opts.required ? { ok: false, error: 'empty' } : okv(null)) : parseMoneyInput(s, opts)), [opts.required, opts.allowNegative]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useField<number | null>(initialMinor == null ? '' : formatMoneyInput(initialMinor, locale), parse, (v) => (v == null ? '' : formatMoneyInput(v, locale)));
  return { ...f, inputProps: { ...f.bind, inputMode: 'decimal' as const, autoComplete: 'off', autoCorrect: 'off', spellCheck: false } };
}

// a quantity in base units (grams, ml, mm for kilo, litre, metre)
export function useQtyField(initialBase: number | null | undefined, uom: QtyUom, locale: string, opts: { required?: boolean; allowNegative?: boolean; min?: number; max?: number } = {}) {
  const parse = useCallback((s: string): Parsed<number | null> => (!s.trim() ? (opts.required ? { ok: false, error: 'empty' } : okv(null)) : parseQtyInput(s, uom, opts)), [uom, opts.required, opts.allowNegative, opts.min, opts.max]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useField<number | null>(initialBase == null ? '' : formatQtyInput(initialBase, uom, locale), parse, (v) => (v == null ? '' : formatQtyInput(v, uom, locale)));
  return { ...f, inputProps: { ...f.bind, inputMode: uom === 'piece' ? ('numeric' as const) : ('decimal' as const), autoComplete: 'off', autoCorrect: 'off', spellCheck: false } };
}

// a whole number: limits, steppers typed by hand
export function useIntField(initial: number | null | undefined, opts: { required?: boolean; min?: number; max?: number } = {}) {
  const parse = useCallback((s: string): Parsed<number | null> => (!s.trim() ? (opts.required ? { ok: false, error: 'empty' } : okv(null)) : parseIntInput(s, opts)), [opts.required, opts.min, opts.max]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useField<number | null>(initial == null ? '' : String(initial), parse, (v) => (v == null ? '' : String(v)));
  return { ...f, inputProps: { ...f.bind, inputMode: 'numeric' as const, pattern: '[0-9]*', autoComplete: 'off', autoCorrect: 'off', spellCheck: false } };
}

export function useEmailField(initial = '', opts: { required?: boolean; autoComplete?: string } = { required: true }) {
  const parse = useCallback((s: string): Parsed<string> => {
    const p = emailProblem(s, { required: opts.required !== false });
    return p ? { ok: false, error: p } : okv(normalizeEmail(s));
  }, [opts.required]);
  const f = useField<string>(initial, parse, (v) => v);
  return {
    ...f,
    inputProps: {
      ...f.bind, type: 'email' as const, inputMode: 'email' as const, autoComplete: opts.autoComplete ?? 'email', autoCapitalize: 'none',
      autoCorrect: 'off', spellCheck: false, maxLength: 254,
    },
  };
}

export function usePhoneField(initial = '', opts: { required?: boolean } = {}) {
  const parse = useCallback((s: string): Parsed<string | null> => (!s.trim() ? (opts.required ? { ok: false, error: 'empty' } : okv(null)) : parsePhone(s)), [opts.required]);
  const f = useField<string | null>(initial, parse);
  return { ...f, inputProps: { ...f.bind, type: 'tel' as const, inputMode: 'tel' as const, autoComplete: 'tel', autoCorrect: 'off', spellCheck: false, maxLength: 30 } };
}

// a new password. never trimmed, the rules say no spaces anyway
export function useNewPasswordField(email?: string | null) {
  const parse = useCallback((s: string): Parsed<string> => {
    const p = passwordProblem(s, email);
    return p ? { ok: false, error: p } : okv(s);
  }, [email]);
  const f = useField<string>('', parse);
  return { ...f, inputProps: { ...f.bind, autoComplete: 'new-password', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, maxLength: 128 } };
}

export function useOtpField() {
  const parse = useCallback((s: string): Parsed<string> => {
    const v = normalizeOtp(s);
    return v.length === 6 ? okv(v) : { ok: false, error: v ? 'invalid' : 'empty' };
  }, []);
  const f = useField<string>('', parse, (v) => v);
  return {
    ...f,
    // a code pasted with spaces or dashes goes in as digits
    inputProps: { ...f.bind, onChange: (e: { target: { value: string } }) => f.setText(normalizeOtp(e.target.value)), inputMode: 'numeric' as const, pattern: '[0-9]*', autoComplete: 'one-time-code', autoCorrect: 'off', spellCheck: false, maxLength: 6 },
  };
}

export function useBarcodeField(initial = '', opts: { required?: boolean } = {}) {
  const parse = useCallback((s: string): Parsed<string | null> => {
    if (!s.trim()) return opts.required ? { ok: false, error: 'empty' } : okv(null);
    // a scanned gs1 digital link stays a link, the server reads the code out of it
    if (/^https?:\/\//i.test(s.trim())) return okv(s.trim());
    return parseBarcodeInput(s);
  }, [opts.required]);
  const f = useField<string | null>(initial, parse, (v) => v ?? '');
  return { ...f, inputProps: { ...f.bind, inputMode: 'text' as const, autoComplete: 'off', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, maxLength: 500 } };
}

// a single line of text: trimmed at the edges and spaces collapsed on blur and on submit
export function useLineField(initial: string | null | undefined, opts: { max: number; required?: boolean; collapse?: boolean; capitalize?: 'words' | 'sentences' | 'none' }) {
  const parse = useCallback((s: string): Parsed<string> => {
    const v = cleanLine(s, { collapse: opts.collapse });
    const p = checkText(v, { max: opts.max, required: opts.required });
    return p ? { ok: false, error: p } : okv(v);
  }, [opts.max, opts.required, opts.collapse]);
  const f = useField<string>(initial ?? '', parse, (v) => v);
  return { ...f, inputProps: { ...f.bind, maxLength: opts.max + 20, autoCapitalize: opts.capitalize ?? 'sentences' } };
}

// multi line text: only the edges trimmed, the inside kept
export function useTextField(initial: string | null | undefined, opts: { max: number; required?: boolean }) {
  const parse = useCallback((s: string): Parsed<string> => {
    const v = cleanText(s);
    const p = checkText(v, { max: opts.max, required: opts.required });
    return p ? { ok: false, error: p } : okv(v);
  }, [opts.max, opts.required]);
  const f = useField<string>(initial ?? '', parse, (v) => v);
  return { ...f, inputProps: { ...f.bind, autoCapitalize: 'sentences' } };
}

// runs every check and says whether all passed. the first field with an error gets the focus
export function checkAll(fields: { check: () => unknown; id: string }[]): boolean {
  let first: string | null = null;
  for (const f of fields) {
    if (f.check() === undefined && !first) first = f.id;
  }
  if (first) document.getElementById(first)?.focus();
  return first === null;
}
