'use client';

// what someone was typing in a long form survives being sent to sign in and back (the session ran
// out halfway), a reload, or the phone dropping the tab. kept in this tab only, for 12 hours, and
// only once the form differs from how it opened.

import { useEffect } from 'react';

const PREFIX = 'custock.draft.';
const MAX_AGE = 12 * 3_600_000;

export function readDraft<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as { at: number; v: T };
    if (!d || Date.now() - d.at > MAX_AGE) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return d.v;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try { sessionStorage.removeItem(PREFIX + key); } catch {}
}

// saves value a moment after each change, or forgets it when the form is back to how it opened
export function useDraft(key: string, value: unknown, initial: unknown) {
  const json = JSON.stringify(value);
  const start = JSON.stringify(initial);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (json === start) sessionStorage.removeItem(PREFIX + key);
        else sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v: JSON.parse(json) }));
      } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [key, json, start]);
}
