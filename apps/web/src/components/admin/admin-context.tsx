'use client';

// session, current business and current shop for the admin. permissions come from me(),
// and the api answers a stale perms version with a refresh, see thinking/03-permissions.md.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CustockApi, MeContext, OrgAccess, OrgSettings, Shop } from '@custock/core';
import type { TFunction } from '@custock/i18n';
import { createBrowserApi, loadTokens, saveTokens } from '@/lib/api-client';
import { useLocale, useT } from '@/lib/i18n-client';
import { can as canFn } from '@/lib/perms';

interface AdminState {
  api: CustockApi;
  me: MeContext;
  org: OrgAccess;
  settings: OrgSettings | null;
  shops: Shop[];
  shopId: string | null; // null = all shops the member can see
  setShopId: (id: string | null) => void;
  can: (perm: string, shopId?: string | null) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  t: TFunction;
  locale: string;
}

const Ctx = createContext<AdminState | null>(null);

export function useAdmin(): AdminState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin outside AdminProvider');
  return v;
}

// the shop filter for queries: the selected shop, or undefined for all
export function useShopFilter(): string | undefined {
  return useAdmin().shopId ?? undefined;
}

// one api per browser tab. it lives outside react, so the closures below can read the latest
// language and perms versions without refs.
const session = {
  locale: 'en',
  versions: new Map<string, number>(),
  onStale: () => {},
  onUnauthorized: () => {},
};
let browserApi: CustockApi | null = null;

function getApi(): CustockApi {
  browserApi ??= createBrowserApi({
    // the server renders <html lang> from the language cookie, so it is right before any effect runs
    getLocale: () => (typeof document !== 'undefined' && document.documentElement.lang) || session.locale,
    getPermsVersion: (orgId) => session.versions.get(orgId) ?? null,
    onUnauthorized: () => { saveTokens(null); session.onUnauthorized(); },
    onPermsStale: () => session.onStale(),
  });
  return browserApi;
}

interface Loaded { me: MeContext; settings: OrgSettings | null; shops: Shop[]; shopId: string | null }

async function loadSession(api: CustockApi): Promise<Loaded> {
  const me = await api.me();
  const org = me.orgs[0];
  if (!org) return { me, settings: null, shops: [], shopId: null };
  session.versions.set(org.orgId, org.permsVersion);
  const [settings, shops] = await Promise.all([api.orgSettings(org.orgId).catch(() => null), api.shops(org.orgId)]);
  const mine = new Set(org.shops.map((x) => x.shopId));
  const saved = localStorage.getItem('custock.shop');
  const shopId = saved === 'all' && org.shops.length > 1 ? null
    : saved && mine.has(saved) ? saved
    : org.shops.length === 1 ? org.shops[0]!.shopId : null;
  return { me, settings, shops: shops.filter((x) => mine.has(x.id)), shopId };
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const isLogin = pathname === '/admin/login';
  useEffect(() => { session.locale = locale; }, [locale]);

  const refresh = useCallback(async () => { setVersion((v) => v + 1); }, []);

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    session.onStale = () => setVersion((v) => v + 1);
    session.onUnauthorized = () => router.replace('/admin/login');
    const go = async () => {
      if (!loadTokens()) { router.replace('/admin/login'); return; }
      try {
        const loaded = await loadSession(getApi());
        if (alive) { setState(loaded); setFailed(false); }
      } catch (e) {
        // only a rejected session signs you out. a network hiccup shows a retry instead
        if ((e as { status?: number }).status === 401 || (e as { code?: string }).code === 'unauthorized') {
          saveTokens(null);
          router.replace('/admin/login');
        } else if (alive) setFailed(true);
      }
    };
    void go();
    return () => { alive = false; };
  }, [isLogin, router, version]);

  const setShopId = useCallback((id: string | null) => {
    setState((s) => (s ? { ...s, shopId: id } : s));
    localStorage.setItem('custock.shop', id ?? 'all');
  }, []);

  const logout = useCallback(async () => {
    await getApi().logout().catch(() => {});
    saveTokens(null);
    setState(null);
    router.replace('/admin/login');
  }, [router]);

  if (isLogin) {
    return <LoginApi.Provider value={{ api: getApi(), onSignedIn: () => setVersion((v) => v + 1) }}>{children}</LoginApi.Provider>;
  }
  if (!state && failed) return <Retry t={t} onRetry={() => setVersion((v) => v + 1)} />;
  if (!state) return <Splash />;
  const org = state.me.orgs[0];
  if (!org) return <NoOrg t={t} onLogout={logout} />;

  const value: AdminState = {
    api: getApi(), me: state.me, org, settings: state.settings, shops: state.shops, shopId: state.shopId, setShopId,
    can: (perm, s) => canFn(org, perm, s === undefined ? state.shopId : s),
    refresh, logout, t, locale,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const LoginApi = createContext<{ api: CustockApi; onSignedIn: () => void } | null>(null);

function Splash() {
  return (
    <div className="min-h-dvh grid place-items-center" aria-busy="true">
      <div className="w-10 h-10 rounded-full skel" />
    </div>
  );
}

function NoOrg({ t, onLogout }: { t: TFunction; onLogout: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <p className="t-title2 m-0">{t('admin.noOrgTitle')}</p>
        <p className="t-body t-2 mt-2">{t('admin.noOrgBody')}</p>
        <button className="btn btn-tinted mt-4" type="button" onClick={onLogout}>{t('common:action.signOut')}</button>
      </div>
    </div>
  );
}

function Retry({ t, onRetry }: { t: TFunction; onRetry: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <p className="t-title3 m-0">{t('admin.offlineTitle')}</p>
        <p className="t-body t-2 mt-2">{t('admin.offlineBody')}</p>
        <button className="btn btn-tinted mt-4" type="button" onClick={onRetry}>{t('common:action.retry')}</button>
      </div>
    </div>
  );
}
