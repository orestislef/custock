'use client';

// where to find the business: each shop with its address, a tap to call, whether it is open now
// and the week's hours. only what the business filled in shows.

import type { PublicShop } from '@custock/core';
import { IconPhone, IconShop } from '@/components/ui/icons';
import { HoursList, OpenNow } from '@/components/ui/shop-hours';
import { useT } from '@/lib/i18n-client';

export function ShopList({ shops, className }: { shops: PublicShop[]; className?: string }) {
  const t = useT();
  const shown = shops.filter((s) => s.address || s.city || s.phone || s.hours);
  if (!shown.length) return null;
  return (
    <section className={`inset-group ${className ?? ''}`} aria-label={t('common:hours.shops')}>
      <h2 className="inset-group-head">{t('common:hours.shops')}</h2>
      <ul className="list" role="list">
        {shown.map((s) => (
          <li key={s.id} className="row has-icon items-start" style={{ paddingTop: 12, paddingBottom: 12 }} data-shop={s.id}>
            <span className="icon-tile" style={{ background: 'var(--c-fill)', color: 'var(--c-ink-2)' }}><IconShop size={18} /></span>
            <span className="row-main flex flex-col gap-1">
              <span className="row-title">{s.name}</span>
              {s.address || s.city ? <span className="row-sub">{[s.address, s.city].filter(Boolean).join(', ')}</span> : null}
              {s.hours ? <OpenNow hours={s.hours} timeZone={s.timezone} /> : null}
              {s.hours ? <HoursList hours={s.hours} /> : null}
            </span>
            {s.phone ? (
              <a className="icon-btn flex-none" href={`tel:${s.phone.replace(/\s+/g, '')}`} aria-label={t('common:hours.call', { shop: s.name })}><IconPhone size={20} /></a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
