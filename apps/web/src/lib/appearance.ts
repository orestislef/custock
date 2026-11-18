'use client';

// light, dark or automatic (the system). stored on this device only; the first paint is handled by
// public/theme.js, which reads the same key. automatic leaves the css media query in charge, so the
// app follows the system live without any script.

import { useSyncExternalStore } from 'react';

export type Appearance = 'auto' | 'light' | 'dark';

export const APPEARANCE_KEY = 'custock.appearance';
const EVENT = 'custock:appearance';
// the shelf colors, the same as the theme-color tags in app/layout.tsx
const BAR: Record<'light' | 'dark', string> = { light: '#F3F3F0', dark: '#0F0F12' };

export function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  if (a === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a);
  // the browser bar: back to the tags' own light and dark colors, or the forced one on both
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute('media') ?? '';
    const own = media.includes('dark') ? BAR.dark : BAR.light;
    m.setAttribute('content', a === 'auto' ? own : BAR[a]);
  });
}

export function setAppearance(a: Appearance) {
  try {
    if (a === 'auto') localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, a);
  } catch {}
  applyAppearance(a);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  // another tab changed it: follow there too
  const onStorage = (e: StorageEvent) => {
    if (e.key !== APPEARANCE_KEY) return;
    applyAppearance(readAppearance());
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, readAppearance, () => 'auto');
}
