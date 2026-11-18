'use client';

// session, current business and current shop for the admin. permissions come from me(),
// and the api answers a stale perms version with a refresh, see thinking/03-permissions.md.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { CustockApi, MeContext, OrgAccess, OrgSettings, Shop } from '@custock/core';
import type { TFunction } from '@custock/i18n';
import { basePath, createBrowserApi, loadTokens, saveTokens, takeHandedMe } from '@/lib/api-client';
import { returnParam } from '@custock/core';
import { useLocale, useT } from '@/lib/i18n-client';
import { can as canFn } from '@/lib/perms';
import { resetCatalogSync } from '@/lib/catalog-cache';
import { wipeLocal } from '@/lib/outbox';
import { disablePush } from '@/lib/push';
import { setDisplayTimeZone } from '@/lib/format';
import { adminLocation, orgPath } from '@/lib/admin-path';
import { OrgSlugCtx } from './org-link';

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
  // a super admin above every business (lib: components/platform)
  superadmin: boolean;
  // switch to another business the person can open (a super admin: any business)
  openOrg: (orgId: string, to?: string) => void;
  // transfers make sense: the business has a second shop (or we cannot tell, then they stay)
  transfersPossible: boolean;
}

const Ctx = createContext<AdminState | null>(null);

// the platform screens (/admin/platform) for a super admin, with or without a business open
export interface PlatformState {
  api: CustockApi;
  me: MeContext;
  currentOrgId: string | null;
  openOrg: (orgId: string, to?: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  t: TFunction;
  locale: string;
}

const PlatformCtx = createContext<PlatformState | null>(null);

export function usePlatform(): PlatformState {
  const v = useContext(PlatformCtx);
  if (!v) throw new Error('usePlatform outside a super admin session');
  return v;
}

export function useAdminOptional(): AdminState | null {
  return useContext(Ctx);
}

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

interface Loaded { me: MeContext; orgId: string | null; settings: OrgSettings | null; shops: Shop[]; shopId: string | null; businessShops?: number | null }

const ORG_KEY = 'custock.org';

// the business on screen: the one picked last, else the first of the person's own. a super admin
// with no business of their own starts on the platform screens instead
// a link from a notification or an email names its business (?org=) and maybe its shop (?shop=).
// they are read once, applied when the person may open them, and taken off the address bar.
function linkTarget(): { org: string | null; shop: string | null } {
  if (typeof window === 'undefined') return { org: null, shop: null };
  const q = new URLSearchParams(window.location.search);
  return { org: q.get('org'), shop: q.get('shop') };
}

function dropLinkParams() {
  const u = new URL(window.location.href);
  if (!u.searchParams.has('org') && !u.searchParams.has('shop')) return;
  u.searchParams.delete('org');
  u.searchParams.delete('shop');
  window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
}

function pickOrg(me: MeContext, urlSlug: string | null) {
  // the address names the business (/admin/<slug>/...): that one, remembered for /admin
  if (urlSlug) {
    const named = me.orgs.find((o) => o.slug === urlSlug);
    if (named) { localStorage.setItem(ORG_KEY, named.orgId); return named; }
  }
  const wanted = linkTarget().org;
  if (wanted) {
    const hit = me.orgs.find((o) => o.orgId === wanted);
    if (hit) localStorage.setItem(ORG_KEY, hit.orgId);
  }
  const saved = localStorage.getItem(ORG_KEY);
  return me.orgs.find((o) => o.orgId === saved) ?? (me.platformRole === 'superadmin' ? me.orgs.find((o) => !o.platformAccess) : me.orgs[0]);
}

async function loadSession(api: CustockApi, urlSlug: string | null): Promise<Loaded> {
  const me = takeHandedMe() ?? await api.me();
  const org = pickOrg(me, urlSlug);
  if (!org) return { me, orgId: null, settings: null, shops: [], shopId: null };
  session.versions.set(org.orgId, org.permsVersion);
  // a paused business refuses its own calls. its people get the paused screen, so nothing else loads
  if (org.suspended && me.platformRole !== 'superadmin') return { me, orgId: org.orgId, settings: null, shops: [], shopId: null };
  const paused = (e: unknown) => {
    if ((e as { code?: string }).code === 'org_suspended') return [] as Shop[];
    throw e;
  };
  // how many shops the whole business has: transfers need a second one. only people who may send
  // can list every shop; for the rest it stays unknown and transfers keep showing (they may receive)
  const canSend = org.orgPerms.includes('stock.transfer.send') || org.shops.some((x) => x.perms.includes('stock.transfer.send'));
  const [settings, shops, businessShops] = await Promise.all([
    api.orgSettings(org.orgId).catch(() => null),
    api.shops(org.orgId).catch(paused),
    canSend ? api.shops(org.orgId, { all: true }).then((x) => x.length, () => null) : Promise.resolve(null),
  ]);
  const mine = new Set(org.shops.map((x) => x.shopId));
  const linked = linkTarget().shop;
  if (linked && mine.has(linked)) localStorage.setItem('custock.shop', linked);
  const saved = localStorage.getItem('custock.shop');
  const shopId = saved === 'all' && org.shops.length > 1 ? null
    : saved && mine.has(saved) ? saved
    : org.shops.length === 1 ? org.shops[0]!.shopId : null;
  return { me, orgId: org.orgId, settings, shops: shops.filter((x) => mine.has(x.id)), shopId, businessShops };
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  // set when a link named a business this person is not in: their own home wins over the section
  const [goHome, setGoHome] = useState(false);
  const loc = adminLocation(pathname);
  // inside a business again: the flag has done its job (adjusted while rendering, not in an effect)
  if (goHome && loc.slug) setGoHome(false);
  // pages that work signed out: sign in, forgot password and the reset link
  const isLogin = pathname === '/admin/login' || pathname === '/admin/forgot' || pathname.startsWith('/admin/reset/');
  useEffect(() => { session.locale = locale; }, [locale]);

  const refresh = useCallback(async () => { setVersion((v) => v + 1); }, []);

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    session.onStale = () => setVersion((v) => v + 1);
    // signing in comes back to the page that was asked for (a notification, an email link)
    const toLogin = () => {
      const next = returnParam(window.location.pathname, window.location.search, basePath);
      router.replace(next && next !== '/admin' ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login');
    };
    session.onUnauthorized = toLogin;
    const go = async () => {
      if (!loadTokens()) { toLogin(); return; }
      try {
        const wanted = linkTarget().org;
        const loaded = await loadSession(getApi(), adminLocation(window.location.pathname.slice(basePath.length) || '/').slug);
        if (!alive) return;
        // a link to a business this person no longer works for: home, quietly
        if (wanted && !loaded.me.orgs.some((o) => o.orgId === wanted)) {
          dropLinkParams();
          setGoHome(true);
          setState(loaded); setFailed(false);
          return;
        }
        dropLinkParams();
        setState(loaded); setFailed(false);
      } catch (e) {
        // only a rejected session signs you out. a network hiccup shows a retry instead
        if ((e as { status?: number }).status === 401 || (e as { code?: string }).code === 'unauthorized') {
          saveTokens(null);
          toLogin();
        } else if (alive) setFailed(true);
      }
    };
    void go();
    return () => { alive = false; };
  }, [isLogin, router, version]);

  const loadedSlug = state?.me.orgs.find((o) => o.orgId === state.orgId)?.slug ?? null;
  const slugKnown = !!loc.slug && !!state?.me.orgs.some((o) => o.slug === loc.slug);
  // another of this person's businesses in the address: load that one (adjusted while rendering)
  if (state && loc.slug && slugKnown && loc.slug !== loadedSlug) { setState(null); setVersion((v) => v + 1); }

  const setShopId = useCallback((id: string | null) => {
    setState((s) => (s ? { ...s, shopId: id } : s));
    localStorage.setItem('custock.shop', id ?? 'all');
  }, []);

  const openOrg = useCallback((orgId: string, to = '/admin') => {
    localStorage.setItem(ORG_KEY, orgId);
    localStorage.removeItem('custock.shop');
    const slug = state?.me.orgs.find((o) => o.orgId === orgId)?.slug ?? null;
    setState(null);
    setVersion((v) => v + 1);
    router.push(orgPath(to, slug));
  }, [router, state]);

  const logout = useCallback(async () => {
    // nothing of this person stays on the device: no push to it, no saved stock work, no catalog copy
    await disablePush(getApi()).catch(() => {});
    await getApi().logout().catch(() => {});
    saveTokens(null);
    localStorage.removeItem(ORG_KEY);
    resetCatalogSync();
    await wipeLocal();
    setState(null);
    router.replace('/admin/login');
  }, [router]);

  if (isLogin) {
    return <LoginApi.Provider value={{ api: getApi(), onSignedIn: () => setVersion((v) => v + 1) }}>{children}</LoginApi.Provider>;
  }
  if (!state && failed) return <Retry t={t} onRetry={() => setVersion((v) => v + 1)} />;
  if (!state) return <Splash />;
  const superadmin = state.me.platformRole === 'superadmin';
  const onPlatform = pathname.startsWith('/admin/platform');
  const org = state.me.orgs.find((o) => o.orgId === state.orgId);
  const platformValue: PlatformState | null = superadmin
    ? { api: getApi(), me: state.me, currentOrgId: org?.orgId ?? null, openOrg, refresh, logout, t, locale }
    : null;
  if (!org) {
    setDisplayTimeZone(null);
    if (superadmin) {
      if (!onPlatform) return <Redirect to="/admin/platform" />;
      return <PlatformCtx.Provider value={platformValue}>{children}</PlatformCtx.Provider>;
    }
    return <NoOrg t={t} onLogout={logout} />;
  }
  if (onPlatform && !superadmin) return <Redirect to={`/admin/${org.slug}`} />;
  // /admin alone, and the old short addresses (/admin/stock/1): on to the business in the address
  if (!onPlatform && !loc.slug) {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    return <Redirect to={loc.legacy && !goHome ? orgPath(`${loc.section}${search}`, org.slug) : `/admin/${org.slug}`} />;
  }
  // a business this person cannot open: their own home, quietly
  // another of this person's businesses in the address: it loads (see the effect above)
  if (loc.slug && loc.slug !== org.slug) return slugKnown ? <Splash /> : <Redirect to={`/admin/${org.slug}`} />;
  // a paused business: its people see a calm screen. a super admin still gets in
  if (org.suspended && !superadmin) {
    return <Paused t={t} name={org.name} others={state.me.orgs.filter((o) => o.orgId !== org.orgId && !o.suspended)} onOpen={openOrg} onLogout={logout} />;
  }

  // every date on the admin screens shows in this business's time zone
  setDisplayTimeZone(state.settings?.timezone ?? org.timezone);
  const value: AdminState = {
    api: getApi(), me: state.me, org, settings: state.settings, shops: state.shops, shopId: state.shopId, setShopId,
    can: (perm, s) => canFn(org, perm, s === undefined ? state.shopId : s),
    refresh, logout, t, locale, superadmin, openOrg,
    transfersPossible: state.businessShops == null || state.businessShops > 1,
  };
  return (
    <PlatformCtx.Provider value={platformValue}>
      <OrgSlugCtx.Provider value={onPlatform ? null : org.slug}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </OrgSlugCtx.Provider>
    </PlatformCtx.Provider>
  );
}

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(to); }, [router, to]);
  return <Splash />;
}

function Paused({ t, name, others, onOpen, onLogout }: { t: TFunction; name: string; others: OrgAccess[]; onOpen: (id: string) => void; onLogout: () => void }) {
  return (
    <div className="min-h-dvh grid place-items-center px-safe-6 text-center">
      <div className="max-w-[420px] page-in">
        <p className="t-title2 m-0">{t('platform.paused.title')}</p>
        <p className="t-body t-2 mt-2 mb-0">{name}</p>
        <div className="flex flex-col items-center gap-2 mt-5">
          {others.map((o) => (
            <button key={o.orgId} className="btn btn-tinted" type="button" onClick={() => onOpen(o.orgId)}>{t('platform.paused.open', { name: o.name })}</button>
          ))}
          <button className="btn btn-gray" type="button" onClick={onLogout}>{t('common:action.signOut')}</button>
        </div>
      </div>
    </div>
  );
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
    <div className="min-h-dvh grid place-items-center px-safe-6 text-center">
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
    <div className="min-h-dvh grid place-items-center px-safe-6 text-center">
      <div>
        <p className="t-title3 m-0">{t('admin.offlineTitle')}</p>
        <p className="t-body t-2 mt-2">{t('admin.offlineBody')}</p>
        <button className="btn btn-tinted mt-4" type="button" onClick={onRetry}>{t('common:action.retry')}</button>
      </div>
    </div>
  );
}
