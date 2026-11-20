'use client';

// the customer side of one business, as a home screen app: who is signed in (a code by email,
// no password), whether they follow this business, and the api with their session. the pages
// under /s/<org> work without an account too, they just offer to join or sign in.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CustockApi, Locale, MeContext, PublicOrderOptions } from '@custock/core';
import { createBrowserApi, loadTokens, saveTokens } from '@/lib/api-client';
import { useLocale } from '@/lib/i18n-client';
import { wipeLocal } from '@/lib/outbox';
import { disablePush, refreshSubscription } from '@/lib/push';
import { setDisplayTimeZone } from '@/lib/format';

type Follow = MeContext['following'][number];

interface ShopperState {
  api: CustockApi;
  slug: string;
  orgName: string;
  // the version of the business icon, part of its url (logo or monogram)
  iconVersion: string;
  joinCode: string | null;
  // the business's quiet hours, 'HH:MM-HH:MM': pushes wait outside them
  quietHours: string;
  // the most pushes one customer gets from this business in a day
  pushDailyCap: number;
  status: 'loading' | 'signedOut' | 'signedIn';
  me: MeContext | null;
  follow: Follow | null; // this business, when the signed in person follows it
  // ordering: the business's choice and the shops to pick up from. undefined while loading, null when off
  orders: PublicOrderOptions | null | undefined;
  requestCode: (email: string) => Promise<{ devCode?: string }>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => void;
}

const Ctx = createContext<ShopperState | null>(null);

export function useShopper(): ShopperState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShopper outside ShopperProvider');
  return v;
}

let api: CustockApi | null = null;
let onUnauthorized = () => {};
function getApi(): CustockApi {
  api ??= createBrowserApi({
    getLocale: () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en',
    onUnauthorized: () => { saveTokens(null); onUnauthorized(); },
  });
  return api;
}

export function ShopperProvider({ slug, orgName, joinCode, iconVersion = '', timeZone, quietHours = '22:00-09:00', pushDailyCap = 2, children }: { slug: string; orgName: string; joinCode: string | null; iconVersion?: string; timeZone?: string; quietHours?: string; pushDailyCap?: number; children: ReactNode }) {
  // dates on this business's pages show in its time zone
  setDisplayTimeZone(timeZone);
  const locale = useLocale() as Locale;
  const [me, setMe] = useState<MeContext | null>(null);
  const [status, setStatus] = useState<ShopperState['status']>('loading');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    onUnauthorized = () => { if (alive) { setMe(null); setStatus('signedOut'); } };
    void (async () => {
      if (!loadTokens()) { if (alive) setStatus('signedOut'); return; }
      try {
        const m = await getApi().me();
        if (alive) { setMe(m); setStatus('signedIn'); }
      } catch {
        if (alive) setStatus(loadTokens() ? 'signedIn' : 'signedOut');
      }
    })();
    return () => { alive = false; };
  }, [version]);

  const follow = me?.following.find((f) => f.orgSlug === slug) ?? null;

  // whether and where this business takes orders. asked once per visit, nothing changes for an error
  const [orders, setOrders] = useState<PublicOrderOptions | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getApi().orderOptions(slug).then((o) => { if (alive) setOrders(o.mode !== 'off' && o.shops.length ? o : null); }, () => { if (alive) setOrders(null); });
    return () => { alive = false; };
  }, [slug]);

  // a subscription the browser rotated goes to the api again
  useEffect(() => {
    if (follow) void refreshSubscription(getApi(), { orgId: follow.orgId, locale });
  }, [follow, locale]);

  const requestCode = useCallback(async (email: string) => {
    const r = await getApi().requestOtp(email.trim().toLowerCase(), locale);
    return { devCode: r.devCode };
  }, [locale]);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const tokens = await getApi().verifyOtp(email.trim().toLowerCase(), code.trim());
    saveTokens(tokens);
    setVersion((v) => v + 1);
  }, []);

  const signOut = useCallback(async () => {
    await disablePush(getApi()).catch(() => {});
    await getApi().logout().catch(() => {});
    saveTokens(null);
    await wipeLocal();
    setMe(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<ShopperState>(() => ({
    api: getApi(), slug, orgName, joinCode, iconVersion, quietHours, pushDailyCap, status, me, follow, orders, requestCode, verifyCode, signOut, reload: () => setVersion((v) => v + 1),
  }), [slug, orgName, joinCode, iconVersion, quietHours, pushDailyCap, status, me, follow, orders, requestCode, verifyCode, signOut]);

  return <Ctx.Provider value={value}><div className="has-tabbar">{children}</div></Ctx.Provider>;
}
