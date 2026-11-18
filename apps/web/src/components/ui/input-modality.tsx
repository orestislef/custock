'use client';

// how the person is using the page right now, on <html data-input="pointer|keyboard">. a tap or a
// click must never leave a focus ring behind (safari treats a tapped select as keyboard focus);
// the ring is for people moving with the keyboard. see globals.css.

import { useEffect } from 'react';

const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ', 'Escape']);

export function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (v: 'pointer' | 'keyboard') => { if (root.dataset.input !== v) root.dataset.input = v; };
    const onPointer = () => set('pointer');
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // typing into a field is not moving focus around
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]')) && e.key !== 'Tab';
      if (!typing && NAV_KEYS.has(e.key)) set('keyboard');
    };
    set('pointer');
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);
  return null;
}
