'use client';

// the admin frame: a sidebar on wide screens, a floating tab bar on phones, and a translucent
// toolbar with the business and shop switcher. sections exist only with the permission behind them.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { featureOn, type Feature } from '@custock/core';
import { useAdmin } from './admin-context';
import { GoHome, featureForRoute } from '@/components/platform/feature-off';
import { OrgSwitcher } from '@/components/platform/org-switcher';
import { PlatformBanners } from '@/components/platform/bits';
import { SuperAdminPill } from '@/components/platform/platform-shell';
import { OutboxBadge } from './outbox-badge';
import { Avatar } from '@/components/ui/kit';
import { LocaleSwitch, Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { AppearanceRow } from '@/components/ui/appearance-switch';
import {
  IconBox, IconChart, IconChevronDown, IconChevronLeft, IconChevronRight, IconGear, IconHome, IconLink, IconLogout, IconMegaphone, IconMore, IconPeople, IconShield, IconShop, IconHistory, IconMail, IconScan, IconWifiOff, IconPhoneApp,
} from '@/components/ui/icons';
import { AppIcon, InstallRow, InstallSteps } from '@/components/pwa/install-coach';
import { PushRow } from '@/components/pwa/push-row';
import { ProfilePhoto } from '@/components/ui/profile-photo';
import { NameRow } from '@/components/ui/name-row';
import { LevelPolicies } from '@/components/policy/level-policies';
import { basePath } from '@/lib/api-client';
import { devBuild } from '@/lib/env';
import { startOfflineSync, useOnline, useOutbox } from '@/lib/outbox';
import { refreshSubscription } from '@/lib/push';

// dev tools only in development builds, never on the server
const devTools = devBuild && process.env.NEXT_PUBLIC_DEV_TOOLS !== '0';

type Section = 'main' | 'business' | 'dev';
type NavItem = { href: string; key: string; icon: (p: { filled?: boolean; size?: number }) => ReactNode; show: boolean; section: Section; children?: { href: string; key: string; show: boolean }[] };

export function useNav(): NavItem[] {
  const { can, org } = useAdmin();
  // a feature the super admin switched off for this business takes its screens away
  const anyShop = (perm: string) => org.orgPerms.includes(perm) || org.shops.some((s) => s.perms.includes(perm)) || org.anyPerms.includes(perm);
  const on = (f: Feature) => featureOn(org, f);
  const items: NavItem[] = [
    { href: '/admin', key: 'home', icon: IconHome, show: true, section: 'main' },
    {
      href: '/admin/stock', key: 'stock', icon: IconBox, show: anyShop('stock.view') || anyShop('products.view'), section: 'main',
      children: [
        { href: '/admin/stock/counts', key: 'counts', show: on('counts') && (anyShop('stock.count') || anyShop('stock.count.approve')) },
        { href: '/admin/stock/transfers', key: 'transfers', show: on('transfers') && (anyShop('stock.transfer.send') || anyShop('stock.transfer.receive')) },
        { href: '/admin/stock/categories', key: 'categories', show: can('categories.manage', null) },
      ],
    },
    // the same rule as the scan screen's modes: looking a code up counts, so viewers get Scan with Look up only
    { href: '/admin/scan', key: 'scan', icon: IconScan, show: ['products.view', 'stock.sell', 'stock.receive', 'stock.count', 'stock.transfer.send'].some(anyShop), section: 'main' },
    { href: '/admin/customers', key: 'customers', icon: IconPeople, show: anyShop('customers.view'), section: 'main' },
    { href: '/admin/posts', key: 'posts', icon: IconMegaphone, show: on('posts') && anyShop('posts.view'), section: 'main' },
    { href: '/admin/reports', key: 'reports', icon: IconChart, show: on('reports') && anyShop('reports.view'), section: 'main' },
    { href: '/admin/team', key: 'team', icon: IconShield, show: anyShop('members.view'), section: 'business' },
    { href: '/admin/join-links', key: 'joinLinks', icon: IconLink, show: anyShop('joinlinks.manage'), section: 'business' },
    { href: '/admin/settings', key: 'settings', icon: IconGear, show: can('org.settings.manage') || anyShop('shop.settings.manage'), section: 'business' },
    { href: '/admin/audit', key: 'audit', icon: IconHistory, show: can('org.audit.view'), section: 'business' },
    { href: '/admin/dev-outbox', key: 'outbox', icon: IconMail, show: devTools && org.orgPerms.includes('org.settings.manage'), section: 'dev' },
  ];
  return items.filter((i) => i.show);
}

function isActive(pathname: string, href: string, exact = false) {
  if (href === '/admin' || exact) return pathname === href;
  return pathname.startsWith(href);
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, api, org, me, shops, shopId, setShopId, logout, locale, refresh, superadmin } = useAdmin();
  const [orgsOpen, setOrgsOpen] = useState(false);
  const pathname = usePathname();
  const routeOff = featureForRoute(pathname);
  const nav = useNav();
  const toast = useToast();
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [installSteps, setInstallSteps] = useState(false);
  // signing out wipes this device, so changes still waiting to sync need a second tap
  const unsynced = useOutbox().queued;
  const [confirmOut, setConfirmOut] = useState(false);
  const appIcon = <AppIcon src={`${basePath}/icons/icon-192.png`} size={44} label="Custock" />;

  // stock changes saved without signal go out when it is back. a push subscription the browser
  // rotated is sent again
  useEffect(() => startOfflineSync(api, (n) => toast(t('offline.synced', { count: n }))), [api, t, toast]);
  useEffect(() => { void refreshSubscription(api, { orgId: null, locale: locale as 'en' }); }, [api, locale]);

  // phone tabs: the first four sections, the rest under More
  const tabs = nav.slice(0, nav.length > 5 ? 4 : 5);
  const rest = nav.slice(tabs.length);
  const stockChildActive = /\/admin\/stock\/(counts|transfers|categories)/.test(pathname);

  const link = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.key === 'stock' ? isActive(pathname, item.href) && !stockChildActive : isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link href={item.href} aria-current={active ? 'page' : undefined} className="nav-link flex items-center gap-3 px-3 min-h-[40px] rounded-[10px] t-body">
          <Icon size={20} filled={active} />
          {t(`nav.${item.key}`)}
        </Link>
        {item.children?.some((c) => c.show) && isActive(pathname, item.href) ? (
          <ul className="list-none p-0 m-0 mt-0.5 flex flex-col gap-0.5">
            {item.children.filter((c) => c.show).map((c) => (
              <li key={c.href}>
                <Link href={c.href} aria-current={isActive(pathname, c.href) ? 'page' : undefined} className="nav-link flex items-center pl-11 pr-3 min-h-[36px] rounded-[10px] t-sub">
                  {t(`stockTabs.${c.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  const main = nav.filter((i) => i.section === 'main');
  const business = nav.filter((i) => i.section === 'business');
  const dev = nav.filter((i) => i.section === 'dev');

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[260px_1fr]">
      <a href="#main" className="skip-link t-sub">{t('admin.skip')}</a>
      {/* sidebar */}
      <aside className="hidden md:flex flex-col sticky top-0 h-dvh px-3 pt-5 pb-4 overflow-y-auto" style={{ background: 'var(--c-shelf)', borderRight: '0.5px solid var(--c-line)' }}>
        <div className="px-3 mb-5">
          <p className="t-cap t-2 m-0">{t('admin.business')}</p>
          {superadmin ? (
            <Link href="/admin/platform" className="nav-link flex items-center gap-2 -mx-3 px-3 min-h-[36px] rounded-[10px] t-sub mb-3" style={{ color: 'var(--c-accent)' }}>
              <IconChevronLeft size={18} />{t('platform.allBusinesses')}
            </Link>
          ) : null}
          {me.orgs.length > 1 ? (
            <button type="button" className="flex items-center gap-1 border-0 bg-transparent p-0 cursor-pointer text-left max-w-full" onClick={() => setOrgsOpen(true)} aria-label={t('platform.switchBusiness')}>
              <span className="t-title3 t-display truncate">{org.name}</span><IconChevronDown size={16} className="flex-none t-2" />
            </button>
          ) : (
            <p className="t-title3 t-display m-0">{org.name}</p>
          )}
          {org.platformAccess ? <div className="mt-1"><SuperAdminPill label={t('platform.access')} /></div> : null}
        </div>
        <nav aria-label={t('admin.nav')}>
          <ul className="list-none p-0 m-0 flex flex-col gap-0.5">{main.map(link)}</ul>
          {business.length ? (
            <>
              <h2 className="t-foot t-2 m-0 mt-6 mb-1 px-3" style={{ fontWeight: 600 }}>{t('admin.businessSection')}</h2>
              <ul className="list-none p-0 m-0 flex flex-col gap-0.5">{business.map(link)}</ul>
            </>
          ) : null}
          {dev.length ? (
            <>
              <hr className="my-4 mx-3 border-0" style={{ borderTop: '0.5px solid var(--c-line)' }} />
              <ul className="list-none p-0 m-0 flex flex-col gap-0.5">{dev.map(link)}</ul>
            </>
          ) : null}
        </nav>
        <div className="flex-1" />
        <button type="button" className="nav-link flex items-center gap-3 px-3 min-h-[52px] rounded-[10px] text-left border-0 bg-transparent cursor-pointer" onClick={() => setUserOpen(true)}>
          <Avatar name={me.user.displayName} size={32} src={me.user.avatarUrl} />
          <span className="flex-1 min-w-0">
            <span className="t-sub block truncate">{me.user.displayName}</span>
            <span className="t-foot t-2 block truncate">{org.roleNames.map((r) => t(`common:role.${r}`, { defaultValue: r })).join(', ')}</span>
          </span>
        </button>
      </aside>

      <div className="min-w-0 flex flex-col">
        {/* toolbar */}
        <header className="bar" data-toolbar>
          <div className="flex items-center gap-2 h-[52px] px-4 md:px-8" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            {me.orgs.length > 1 ? (
              <button type="button" className="md:hidden t-headline inline-flex items-center gap-1 border-0 bg-transparent p-0 max-w-[45%]" onClick={() => setOrgsOpen(true)} aria-label={t('platform.switchBusiness')}>
                <span className="truncate">{org.name}</span><IconChevronDown size={14} className="flex-none t-2" />
              </button>
            ) : <span className="md:hidden t-headline">{org.name}</span>}
            <span id="bar-title" className="t-headline flex-1 text-center md:text-left truncate opacity-0 transition-opacity" aria-hidden="true" />
            <span id="bar-action" className="md:hidden" />
            <OutboxBadge />
            <ShopSwitcher shops={shops} shopId={shopId} onChange={setShopId} canAll={org.shops.length > 1} />
            <button type="button" className="md:hidden icon-btn" aria-label={t('admin.account')} onClick={() => setUserOpen(true)}>
              <Avatar name={me.user.displayName} size={30} src={me.user.avatarUrl} />
            </button>
          </div>
          {!online ? <p className="offline-line m-0" role="status"><IconWifiOff size={16} className="flex-none" />{t('offline.line')}</p> : null}
        </header>

        <main id="main" tabIndex={-1} className="outline-none flex-1 px-4 md:px-8 pb-[calc(110px+env(safe-area-inset-bottom))] md:pb-12 w-full max-w-[1200px]">
          <PlatformBanners me={me} t={t} />
          {routeOff && !featureOn(org, routeOff) ? <GoHome /> : children}
        </main>
      </div>

      {/* phone tab bar, floating glass */}
      <nav aria-label={t('admin.nav')} className="glass md:hidden fixed z-30 left-3 right-3 flex justify-around rounded-[28px] px-1"
        style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))', height: 62, boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 0 0 0.5px var(--c-line)' }}>
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 hover:no-underline"
              style={{ color: active ? 'var(--c-accent)' : 'var(--c-ink-2)' }}>
              <Icon size={24} filled={active} />
              <span className="t-cap2 truncate max-w-full" style={{ fontWeight: active ? 600 : 500 }}>{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
        {rest.length ? (
          <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center justify-center gap-0.5 flex-1 border-0 bg-transparent"
            style={{ color: rest.some((r) => isActive(pathname, r.href)) ? 'var(--c-accent)' : 'var(--c-ink-2)' }}>
            <IconMore size={24} />
            <span className="t-cap2" style={{ fontWeight: 500 }}>{t('nav.more')}</span>
          </button>
        ) : null}
      </nav>

      <OrgSwitcher open={orgsOpen} onClose={() => setOrgsOpen(false)} />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')}>
        {superadmin ? (
          <ul className="list mb-4" role="list">
            <li>
              <Link href="/admin/platform" className="row has-icon" onClick={() => setMoreOpen(false)}>
                <span className="icon-tile"><IconShield size={18} /></span>
                <span className="row-main row-title">{t('platform.allBusinesses')}</span>
                <IconChevronRight size={16} className="chev" />
              </Link>
            </li>
          </ul>
        ) : null}
        <ul className="list mb-4" role="list">
          {rest.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className="row has-icon" onClick={() => setMoreOpen(false)}>
                  <span className="icon-tile"><Icon size={18} /></span>
                  <span className="row-main row-title">{t(`nav.${item.key}`)}</span>
                  <IconChevronRight size={16} className="chev" />
                </Link>
              </li>
            );
          })}
        </ul>
        <InstallRow appName="Custock" icon={appIcon} render={(open, label) => (
          <ul className="list mb-2" role="list">
            <li>
              <button type="button" className="row has-icon" onClick={open}>
                <span className="icon-tile"><IconPhoneApp size={18} /></span>
                <span className="row-main row-title">{label}</span>
                <IconChevronRight size={16} className="chev" />
              </button>
            </li>
          </ul>
        )} />
      </Sheet>

      <Sheet open={userOpen} onClose={() => { setUserOpen(false); setConfirmOut(false); }} title={t('admin.account')}>
        <ProfilePhoto api={api} name={me.user.displayName} avatarUrl={me.user.avatarUrl} onChanged={() => void refresh()} className="mb-4">
          <p className="t-headline m-0 truncate">{me.user.displayName}</p>
          <p className="t-sub t-2 m-0 truncate">{me.user.email}</p>
        </ProfilePhoto>
        {/* where they work and as what, nothing about permissions */}
        <ul className="list mb-4" role="list">
          <li><NameRow api={api} name={me.user.displayName} onSaved={() => void refresh()} /></li>
          <li className="row">
            <span className="row-main row-title">{t('admin.role')}</span>
            <span className="t-body t-2 text-right">{org.roleNames.map((r) => t(`common:role.${r}`, { defaultValue: r })).join(', ')}</span>
          </li>
          {org.shops.length ? (
            <li className="row">
              <span className="row-main row-title">{t('admin.shops')}</span>
              <span className="t-body t-2 text-right min-w-0 truncate">{org.shops.map((s) => s.name).join(', ')}</span>
            </li>
          ) : null}
        </ul>
        <section className="inset-group" style={{ marginBottom: 16 }}>
          <div className="list">
            <PushRow api={api} orgId={null} title={t('push.staffTitle')} sub={t('push.staffSub')} onInstall={() => setInstallSteps(true)} />
          </div>
          <p className="inset-group-foot">{t('push.staffFoot')}</p>
        </section>
        {/* which staff alerts this person wants, their own choice */}
        <LevelPolicies level={{ kind: 'me' }} groups={['alerts']} />
        <ul className="list mb-2" role="list">
          <li className="row"><span className="row-main row-title">{t('locale.label')}</span><LocaleSwitch /></li>
          <AppearanceRow />
          <li>
            <button type="button" className="row" onClick={() => (unsynced && !confirmOut ? setConfirmOut(true) : void logout())} style={{ color: 'var(--c-error)' }}>
              <IconLogout size={20} />
              <span className="row-main row-title">{confirmOut ? t('offline.signOutAnyway') : t('common:action.signOut')}</span>
            </button>
          </li>
        </ul>
        {confirmOut ? <p className="inset-group-foot mb-2" role="alert" style={{ color: 'var(--c-error)' }}>{t('offline.signOutWarning', { count: unsynced })}</p> : null}
      </Sheet>
      <InstallSteps open={installSteps} onClose={() => setInstallSteps(false)} appName="Custock" icon={appIcon} />
    </div>
  );
}

function ShopSwitcher({ shops, shopId, onChange, canAll }: { shops: { id: string; name: string }[]; shopId: string | null; onChange: (id: string | null) => void; canAll: boolean }) {
  const { t } = useAdmin();
  if (shops.length <= 1 && !canAll) {
    return shops[0] ? <span className="t-sub t-2 inline-flex items-center gap-1"><IconShop size={16} />{shops[0].name}</span> : null;
  }
  return (
    <Picker
      label={t('admin.shop')}
      icon={<IconShop size={16} />}
      value={shopId ?? 'all'}
      onChange={(v) => onChange(v === 'all' ? null : v)}
      options={[...(canAll ? [{ value: 'all', label: t('common:scope.allShops') }] : []), ...shops.map((s) => ({ value: s.id, label: s.name }))]}
    />
  );
}

// a page with an ios large title that hands over to the small title in the toolbar on scroll.
// the back link sits above the title. on phones the primary action becomes a + in the toolbar.
export function Page({ title, subtitle, actions, back, phoneAction, children }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; phoneAction?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const barTitle = document.getElementById('bar-title');
    const bar = document.querySelector('[data-toolbar]');
    if (!ref.current || !barTitle) return;
    barTitle.textContent = title;
    const io = new IntersectionObserver(([e]) => {
      const hidden = !e!.isIntersecting;
      barTitle.style.opacity = hidden ? '1' : '0';
      bar?.classList.toggle('scrolled', hidden);
    }, { rootMargin: '-52px 0px 0px 0px' });
    io.observe(ref.current);
    return () => { io.disconnect(); barTitle.style.opacity = '0'; bar?.classList.remove('scrolled'); };
  }, [title]);
  return (
    <div className="page-in">
      {back ? <Link href={back.href} className="inline-flex items-center min-h-[44px] -ml-2 mt-1 t-body"><IconChevronLeft size={24} />{back.label}</Link> : null}
      <div className={`flex items-end gap-3 ${back ? 'pt-0' : 'pt-2'} pb-5 flex-wrap`}>
        <div className="flex-1 min-w-[200px]">
          <h1 ref={ref} className="t-large m-0">{title}</h1>
          {subtitle ? <p className="t-sub t-2 m-0 mt-1">{subtitle}</p> : null}
        </div>
        {actions ? <div className={`${phoneAction ? 'hidden md:flex' : 'flex'} items-center gap-2 flex-wrap`}>{actions}</div> : null}
        {phoneAction ? <div className="md:hidden">{phoneAction}</div> : null}
      </div>
      {children}
    </div>
  );
}
