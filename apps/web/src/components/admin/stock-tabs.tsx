'use client';

import Link from '@/components/admin/org-link';
import { useSectionPath as usePathname } from '@/components/admin/org-link';
import { featureOn } from '@custock/core';
import { useAdmin } from './admin-context';

// products, counts and transfers live under stock. underline tabs on phones and tablets,
// the sidebar shows them as a second level on wide screens.
export function StockTabs() {
  const { t, can, org, transfersPossible } = useAdmin();
  const pathname = usePathname();
  const tabs = [
    { href: '/admin/stock', key: 'products', show: true },
    { href: '/admin/stock/counts', key: 'counts', show: featureOn(org, 'counts') && (can('stock.count', null) || can('stock.count.approve', null)) },
    { href: '/admin/stock/transfers', key: 'transfers', show: featureOn(org, 'transfers') && transfersPossible && (can('stock.transfer.send', null) || can('stock.transfer.receive', null)) },
    { href: '/admin/stock/categories', key: 'categories', show: can('categories.manage', null) },
  ].filter((x) => x.show);
  if (tabs.length < 2) return null;
  const active = (href: string) => (href === '/admin/stock' ? !/\/admin\/stock\/(counts|transfers|categories)/.test(pathname) : pathname.startsWith(href));
  return (
    <nav aria-label={t('stockTabs.label')} className="tabs md:hidden">
      {tabs.map((x) => (
        <Link key={x.href} href={x.href} aria-current={active(x.href) ? 'page' : undefined}>{t(`stockTabs.${x.key}`)}</Link>
      ))}
    </nav>
  );
}
