'use client';

// mounted once in the root layout: registers the service worker (production builds) and keeps
// chrome's install prompt for the moment we offer it in context.

import { useEffect } from 'react';
import { captureInstallPrompt } from '@/lib/pwa';
import { registration } from '@/lib/push';

captureInstallPrompt();

export function PwaRoot() {
  useEffect(() => {
    // after the page settled, so the first load is not slowed down
    const go = () => void registration();
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }, []);
  return null;
}
