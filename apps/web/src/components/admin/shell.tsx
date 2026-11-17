'use client';

// the admin frame: a sidebar on wide screens, a floating tab bar on phones, and a translucent
// toolbar with the business and shop switcher. sections exist only with the permission behind them.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAdmin } from './admin-context';
import { Avatar } from '@/components/ui/kit';
import { LocaleSwitch, Sheet } from '@/components/ui/client-kit';
import {
  IconBox, IconChart, IconChevronDown, IconGear, IconHome, IconLink, IconLogout, IconMegaphone, IconMore, IconPeople, IconShield, IconShop,
} from '@/components/ui/icons';

type NavItem = { href: string; key: string; icon: (p: { filled?: boolean; size?: number }) => ReactNode; show: boolean };

export function useNav(): NavItem[] {
  const { can, org } = useAdmin();
  const anyShop = (perm: string) => org.orgPerms.includes(perm) || org.shops.some((s) => s.perms.includes(perm)) || org.anyPerms.includes(perm);
  return [
    { href: '/admin', key: 'home', icon: IconHome, show: true },
    { href: '/admin/stock', key: 'stock', icon: IconBox, show: anyShop('stock.view') || anyShop('products.view') },
    { href: '/admin/customers', key: 'customers', icon: IconPeople, show: anyShop('customers.view') },
    { href: '/admin/posts', key: 'posts', icon: IconMegaphone, show: anyShop('posts.view') },
    { href: '/admin/reports', key: 'reports', icon: IconChart, show: anyShop('reports.view') },
    { href: '/admin/team', key: 'team', icon: IconShield, show: anyShop('members.view') },
    { href: '/admin/join-links', key: 'joinLinks', icon: IconLink, show: anyShop('joinlinks.manage') },
    { href: '/admin/settings', key: 'settings', icon: IconGear, show: can('org.settings.manage') || anyShop('shop.settings.manage') },
  ].filter((i) => i.show);
}

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, org, me, shops, shopId, setShopId, logout } = useAdmin();
  const pathname = usePathname();
  const nav = useNav();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  // phone tabs: the first four sections, the rest under More
  const tabs = nav.slice(0, nav.length > 5 ? 4 : 5);
  const rest = nav.slice(tabs.length);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[260px_1fr]">
      {/* sidebar */}
      <aside className="hidden md:flex flex-col sticky top-0 h-dvh px-3 pt-5 pb-4" style={{ background: 'var(--c-shelf)', borderRight: '0.5px solid var(--c-line)' }}>
        <div className="px-3 mb-5">
          <p className="t-cap t-2 m-0 uppercase-none">{t('admin.business')}</p>
          <p className="t-title3 t-display m-0">{org.name}</p>
        </div>
        <nav aria-label={t('admin.nav')} className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-3 px-3 min-h-[40px] rounded-[10px] t-body hover:no-underline"
                style={{ color: active ? 'var(--c-accent)' : 'var(--c-ink)', background: active ? 'var(--c-accent-tint)' : 'transparent', fontWeight: active ? 600 : 400 }}
              >
                <Icon size={20} filled={active} />
                {t(`nav.${item.key}`)}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <button type="button" className="flex items-center gap-3 px-3 min-h-[52px] rounded-[10px] text-left hover:bg-[var(--c-fill)]" onClick={() => setUserOpen(true)}>
          <Avatar name={me.user.displayName} size={32} />
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
            <span className="md:hidden t-headline">{org.name}</span>
            <span id="bar-title" className="t-headline flex-1 text-center md:text-left truncate opacity-0 transition-opacity" aria-hidden="true" />
            <ShopSwitcher shops={shops} shopId={shopId} onChange={setShopId} canAll={org.shops.length > 1} />
            <button type="button" className="md:hidden icon-btn" aria-label={t('admin.account')} onClick={() => setUserOpen(true)}>
              <Avatar name={me.user.displayName} size={30} />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 pb-[calc(110px+env(safe-area-inset-bottom))] md:pb-12 w-full max-w-[1100px]">{children}</main>
      </div>

      {/* phone tab bar, floating glass */}
      <nav aria-label={t('admin.nav')} className="md:hidden fixed z-30 left-3 right-3 flex justify-around rounded-[28px] px-1"
        style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))', height: 62, background: 'var(--c-bar-surface)', WebkitBackdropFilter: 'saturate(180%) blur(24px)', backdropFilter: 'saturate(180%) blur(24px)', boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 0 0 0.5px var(--c-line)' }}>
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

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('nav.more')}>
        <div className="list mb-2">
          {rest.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="row has-icon" onClick={() => setMoreOpen(false)}>
                <span className="icon-tile"><Icon size={18} /></span>
                <span className="row-main row-title">{t(`nav.${item.key}`)}</span>
              </Link>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={userOpen} onClose={() => setUserOpen(false)} title={t('admin.account')}>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={me.user.displayName} size={48} />
          <div className="min-w-0">
            <p className="t-headline m-0 truncate">{me.user.displayName}</p>
            <p className="t-sub t-2 m-0 truncate">{me.user.email}</p>
          </div>
        </div>
        <div className="list mb-4">
          {org.shops.map((s) => (
            <div key={s.shopId} className="row">
              <span className="row-main">
                <span className="row-title block">{s.name}</span>
                <span className="row-sub block">{t('admin.permsCount', { count: s.perms.length })}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="list mb-2">
          <div className="row"><span className="row-main row-title">{t('locale.label')}</span><LocaleSwitch compact /></div>
          <button type="button" className="row" onClick={() => void logout()} style={{ color: 'var(--c-error)' }}>
            <IconLogout size={20} />
            <span className="row-main row-title">{t('common:action.signOut')}</span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function ShopSwitcher({ shops, shopId, onChange, canAll }: { shops: { id: string; name: string }[]; shopId: string | null; onChange: (id: string | null) => void; canAll: boolean }) {
  const { t } = useAdmin();
  if (shops.length <= 1 && !canAll) {
    return shops[0] ? <span className="t-sub t-2 inline-flex items-center gap-1"><IconShop size={16} />{shops[0].name}</span> : null;
  }
  return (
    <label className="relative inline-flex items-center gap-1.5 h-[34px] pl-3 pr-2 rounded-full cursor-pointer" style={{ background: 'var(--c-fill)' }}>
      <IconShop size={16} />
      <span className="sr-only">{t('admin.shop')}</span>
      <select
        className="appearance-none bg-transparent border-0 outline-none t-sub cursor-pointer pr-4"
        style={{ color: 'var(--c-ink)', fontWeight: 500 }}
        value={shopId ?? 'all'}
        onChange={(e) => onChange(e.target.value === 'all' ? null : e.target.value)}
      >
        {canAll ? <option value="all">{t('common:scope.allShops')}</option> : null}
        {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <IconChevronDown size={14} className="absolute right-2 pointer-events-none" />
    </label>
  );
}

// a page with an ios large title that hands over to the small title in the toolbar on scroll
export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
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
      <div className="flex items-end gap-3 pt-2 pb-5 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h1 ref={ref} className="t-large m-0">{title}</h1>
          {subtitle ? <p className="t-sub t-2 m-0 mt-1">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
