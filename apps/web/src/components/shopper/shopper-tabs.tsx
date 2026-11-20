'use client';

// the tab bar of a business's home screen app: shop, offers, news, you. floating glass like the
// staff app, on every width (the customer pages are one column).

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { IconBag, IconBox, IconChevronRight, IconNews, IconTag, IconUser } from '@/components/ui/icons';
import { cartCount, useCart } from '@/lib/order-cart';
import { useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

export function ShopperTabs() {
  const t = useT();
  const { slug, orders } = useShopper();
  const pathname = usePathname();
  const home = `/s/${slug}`;
  const cart = useCart(slug);
  const count = cartCount(cart);
  // the order being put together, one tap away on every page but its own
  const pill = orders && count > 0 && !pathname.startsWith(`${home}/order`);
  // toasts move up while the pill is there
  useEffect(() => {
    if (!pill) return;
    document.documentElement.setAttribute('data-order-pill', '');
    return () => document.documentElement.removeAttribute('data-order-pill');
  }, [pill]);
  const tabs = [
    { href: home, key: 'shop', icon: IconBox, active: pathname === home || pathname.startsWith(`${home}/p/`) },
    { href: `${home}/offers`, key: 'offers', icon: IconTag, active: pathname.startsWith(`${home}/offers`) },
    { href: `${home}/news`, key: 'news', icon: IconNews, active: pathname.startsWith(`${home}/news`) },
    { href: `${home}/me`, key: 'you', icon: IconUser, active: pathname.startsWith(`${home}/me`) || pathname.startsWith(`${home}/orders`) },
  ];
  return (
    <>
    {/* room at the end of the page so the pill never covers the last row */}
    {pill ? <div aria-hidden="true" style={{ height: 62 }} /> : null}
    {pill ? (
      <Link href={`${home}/order`} className="glass fixed z-30 inset-x-safe-3 mx-auto flex items-center gap-3 rounded-[22px] pl-4 pr-3 max-w-[460px] hover:no-underline"
        style={{ bottom: 'calc(82px + env(safe-area-inset-bottom))', height: 52, color: 'var(--c-ink)', boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 0 0 0.5px var(--c-line)' }}>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full flex-none" style={{ background: 'var(--c-accent)', color: '#fff' }}><IconBag size={18} /></span>
        <span className="flex-1 min-w-0">
          <span className="t-headline block truncate">{t('order.pill')}</span>
          <span className="t-foot t-2 block">{t('order.products', { count })}</span>
        </span>
        <IconChevronRight size={16} className="chev" />
      </Link>
    ) : null}
    <nav data-tabbar="" aria-label={t('shopper.tabsLabel')} className="glass fixed z-30 inset-x-safe-3 mx-auto flex justify-around rounded-[28px] px-1 max-w-[460px]"
      style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))', height: 62, boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 0 0 0.5px var(--c-line)' }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link key={tab.key} href={tab.href} aria-current={tab.active ? 'page' : undefined} className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 hover:no-underline"
            style={{ color: tab.active ? 'var(--c-accent)' : 'var(--c-ink-2)' }}>
            <Icon size={24} filled={tab.active} />
            <span className="t-cap2 truncate max-w-full" style={{ fontWeight: tab.active ? 600 : 500 }}>{t(`shopper.tabs.${tab.key}`)}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}
