'use client';

import { useSyncExternalStore } from 'react';

// true when the media query matches. false during server rendering, so wide layouts appear after hydration.
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
