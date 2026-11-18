'use client';

// the home screen side of the web app: is it installed, can the browser install it, and the
// install prompt that chrome hands us once (beforeinstallprompt). safari has no prompt, there the
// coach shows the two taps in the share sheet.

import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // ipads report a mac, with touch
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isPhone(): boolean {
  return isIOS() || isAndroid() || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches);
}

// ---------------------------------------------------------------- the chrome install prompt

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function captureInstallPrompt() {
  if (typeof window === 'undefined' || (window as { __custockPwa?: boolean }).__custockPwa) return;
  (window as { __custockPwa?: boolean }).__custockPwa = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button, in context
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia('(display-mode: standalone)');
  mq.addEventListener?.('change', cb);
  return () => { listeners.delete(cb); mq.removeEventListener?.('change', cb); };
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'none';

function mode(): InstallMode {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
}

export function useInstall(): { mode: InstallMode; install: () => Promise<boolean> } {
  const m = useSyncExternalStore(subscribe, mode, () => 'none' as InstallMode);
  return {
    mode: m,
    install: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      emit();
      return outcome === 'accepted';
    },
  };
}

// ---------------------------------------------------------------- dismissing the coach

const DAY = 86_400_000;

function subscribeDismiss(cb: () => void) {
  window.addEventListener('custock-coach', cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener('custock-coach', cb); window.removeEventListener('storage', cb); };
}

// a dismissed coach stays away for 30 days in that place
export function useCoachDismissed(place: string): [boolean, () => void] {
  const key = `coach.${place}`;
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    () => Date.now() - Number(localStorage.getItem(key) ?? 0) < 30 * DAY,
    () => true,
  );
  return [dismissed, () => { localStorage.setItem(key, String(Date.now())); window.dispatchEvent(new Event('custock-coach')); }];
}
