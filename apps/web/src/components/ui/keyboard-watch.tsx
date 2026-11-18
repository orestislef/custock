'use client';

// marks <html data-kb> while the on screen keyboard is up on a phone, with --kb-page as the part
// of the screen it covers. ios keeps fixed bars (the floating tab bars, toasts) at the bottom of
// the layout viewport, so while typing they would float over the fields or sit behind the
// keyboard: globals.css hides the tab bars and lifts toasts above the keyboard for that time.
// sheets do their own placement (client-kit). nothing here changes layout.

import { useEffect } from 'react';

export function KeyboardWatch() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    let last = '';
    const apply = () => {
      frame = 0;
      const phone = window.matchMedia('(max-width: 767px)').matches;
      const inset = phone ? Math.max(0, Math.round(root.clientHeight - (vv.height + vv.offsetTop))) : 0;
      // a gap this tall is the keyboard, not the browser's own bars
      const up = inset > 80;
      const key = up ? String(inset) : 'down';
      if (key === last) return;
      last = key;
      if (up) { root.setAttribute('data-kb', ''); root.style.setProperty('--kb-page', `${inset}px`); }
      else { root.removeAttribute('data-kb'); root.style.removeProperty('--kb-page'); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    apply();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      root.removeAttribute('data-kb');
      root.style.removeProperty('--kb-page');
    };
  }, []);
  return null;
}
