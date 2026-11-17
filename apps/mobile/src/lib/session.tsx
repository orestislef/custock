// who is signed in, which business and shop they are looking at, and which side of the app.
// permissions come from /v1/me/context and are refreshed on resume and when the server says so.

import { can as canCore, type MeContext, type OrgAccess, type Tokens } from '@custock/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { api, onAccessChanged, onAuthLost, setAccessToken, setPermsVersion } from './api';
import { getItem, setItem } from './storage';

export type Side = 'work' | 'shopper';

interface SessionValue {
  ready: boolean;
  me: MeContext | null;
  org: OrgAccess | null;
  shopId: string | null; // null = all shops the member can see
  side: Side;
  signIn: (tokens: Tokens) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setOrg: (orgId: string) => void;
  setShop: (shopId: string | null) => void;
  setSide: (side: Side) => void;
  can: (perm: string, shopId?: string | null) => boolean;
  accessChangedAt: number | null;
}

const Ctx = createContext<SessionValue | null>(null);

const K = { tokens: 'custock.tokens', org: 'custock.org', shop: 'custock.shop', side: 'custock.side' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeContext | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [side, setSideState] = useState<Side>('work');
  const [accessChangedAt, setAccessChangedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const ctx = await api.me();
    setMe(ctx);
    for (const o of ctx.orgs) setPermsVersion(o.orgId, o.permsVersion);
    const savedOrg = await getItem(K.org);
    const org = ctx.orgs.find((o) => o.orgId === savedOrg) ?? ctx.orgs[0] ?? null;
    setOrgId(org?.orgId ?? null);
    const savedShop = await getItem(K.shop);
    if (org) {
      const only = org.shops.length === 1 ? org.shops[0]!.shopId : null;
      setShopId(org.shops.some((s) => s.shopId === savedShop) ? savedShop : only);
    }
    const savedSide = (await getItem(K.side)) as Side | null;
    setSideState(!org ? 'shopper' : savedSide === 'shopper' && ctx.following.length ? 'shopper' : 'work');
    return ctx;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // signing out works offline too
    }
    setAccessToken(null);
    await setItem(K.tokens, null);
    setMe(null);
    setOrgId(null);
    qc.clear(); // local data of the business goes with the session
  }, [qc]);

  useEffect(() => {
    onAuthLost(() => void signOut());
    onAccessChanged(() => {
      setAccessChangedAt(Date.now());
      void load();
      void qc.invalidateQueries();
    });
    (async () => {
      const raw = await getItem(K.tokens);
      if (raw) {
        try {
          const t = JSON.parse(raw) as Tokens;
          setAccessToken(t.accessToken);
          await load();
        } catch {
          setAccessToken(null);
          await setItem(K.tokens, null);
        }
      }
      setReady(true);
    })();
  }, [load, signOut, qc]);

  // refresh permissions when the app comes back to the foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && me) void load().catch(() => {});
    });
    return () => sub.remove();
  }, [load, me]);

  const signIn = useCallback(async (tokens: Tokens) => {
    setAccessToken(tokens.accessToken);
    await setItem(K.tokens, JSON.stringify(tokens));
    await load();
  }, [load]);

  const org = useMemo(() => me?.orgs.find((o) => o.orgId === orgId) ?? null, [me, orgId]);

  const value: SessionValue = {
    ready,
    me,
    org,
    shopId,
    side,
    signIn,
    signOut,
    refresh: async () => {
      await load();
    },
    setOrg: (id) => {
      setOrgId(id);
      setShopId(null);
      void setItem(K.org, id);
      void qc.invalidateQueries();
    },
    setShop: (id) => {
      setShopId(id);
      void setItem(K.shop, id);
    },
    setSide: (s) => {
      setSideState(s);
      void setItem(K.side, s);
    },
    can: (perm, shop) => (org ? canCore(org, perm, shop === undefined ? shopId : shop) : false),
    accessChangedAt,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

// the org is always there on the work side
export function useOrg(): OrgAccess {
  const { org } = useSession();
  if (!org) throw new Error('no org');
  return org;
}
