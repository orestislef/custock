'use client';

// a link with a #section (for example a storage alert to #storage) on a page that draws after its
// data arrives: scroll to the section once it exists, as the browser would for a static page
import { useEffect } from 'react';

export function useHashScroll(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof window === 'undefined' || !window.location.hash) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!/^[a-z0-9-]{1,40}$/i.test(id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [ready]);
}
