'use client';

// the front door and the sign in pages for someone who is already signed in: straight into the app,
// with nothing of the page shown in between. public/theme.js marks <html data-session> before the
// first paint when this device holds a session, and css keeps [data-guest] content invisible until
// this gate has decided. a session that turns out to be over shows the page as normal.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { safeReturnPath } from '@custock/core';
import { createBrowserApi, handOffMe, loadTokens, saveTokens } from '@/lib/api-client';

function show() {
  document.documentElement.removeAttribute('data-session');
}

export function SessionGate({ honorNext = false }: { honorNext?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!loadTokens()) { show(); return; }
    let alive = true;
    const api = createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' });
    const next = honorNext ? safeReturnPath(new URLSearchParams(window.location.search).get('next')) : null;
    void api.me().then((me) => {
      if (!alive) return;
      const own = me.orgs.filter((o) => !o.platformAccess);
      const dest = next
        ?? (own.length ? '/admin'
          : me.platformRole === 'superadmin' ? '/admin/platform'
          : me.following.length ? `/s/${me.following[0]!.orgSlug}`
          : null);
      if (dest) {
        if (dest.startsWith('/admin')) handOffMe(me);
        router.replace(dest);
      } else show();
    }, (e: { status?: number; code?: string }) => {
      if (!alive) return;
      // a session that is over (the refresh failed too): the page, signed out
      if (e?.status === 401 || e?.code === 'unauthorized') { saveTokens(null); show(); return; }
      // no network: the app has its own offline screens, the front door has none
      if (localStorage.getItem('custock.org')) router.replace('/admin');
      else show();
    });
    return () => { alive = false; };
  }, [router, honorNext]);
  return null;
}
