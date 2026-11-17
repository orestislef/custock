'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAdmin } from './admin-context';

// products, counts and transfers live under stock. a segmented row of links, like a ios scope bar.
export function StockTabs() {
  const { t, can } = useAdmin();
  const pathname = usePathname();
  const tabs = [
    { href: '/admin/stock', key: 'products', show: true },
    { href: '/admin/stock/counts', key: 'counts', show: can('stock.count', null) || can('stock.count.approve', null) },
    { href: '/admin/stock/transfers', key: 'transfers', show: can('stock.transfer.send', null) || can('stock.transfer.receive', null) },
  ].filter((x) => x.show);
  if (tabs.length < 2) return null;
  const active = (href: string) => (href === '/admin/stock' ? !/\/admin\/stock\/(counts|transfers)/.test(pathname) : pathname.startsWith(href));
  return (
    <nav aria-label={t('stockTabs.label')} className="seg mb-5" style={{ display: 'inline-grid' }}>
      {tabs.map((x) => (
        <Link key={x.href} href={x.href} aria-current={active(x.href) ? 'page' : undefined}
          className="inline-flex items-center justify-center hover:no-underline"
          style={{
            padding: '4px 14px', borderRadius: 7, fontSize: 13, minHeight: 28, color: 'var(--c-ink)',
            fontWeight: active(x.href) ? 600 : 500,
            background: active(x.href) ? 'var(--c-surface)' : 'transparent',
            boxShadow: active(x.href) ? '0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)' : undefined,
          }}>
          {t(`stockTabs.${x.key}`)}
        </Link>
      ))}
    </nav>
  );
}
