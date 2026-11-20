import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicProduct } from '@custock/core';
import type { TFunction } from '@custock/i18n/client';
import { money, date } from '@/lib/format';
import { Group, Row, StockBadge } from '@/components/ui/kit';
import { Photo } from '@/components/ui/client-kit';
import { CategoryPlaceholder } from '@/components/ui/category-picture';
import { IconBell, IconShop } from '@/components/ui/icons';

// the product as a customer sees it: what the merchant allows, and nothing else
// actions replaces the join and notify links, for a signed in follower in the business's app
export function ProductView({ p, t, locale, joinHref, notifyHref, actions }: { p: PublicProduct; t: TFunction; locale: string; joinHref?: string | null; notifyHref?: string | null; actions?: ReactNode }) {
  const anyOut = p.availability.some((a) => a.state === 'out');
  const stockShown = p.availability.some((a) => a.state != null);
  return (
    <article>
      <div className="card mb-5" style={{ aspectRatio: '4 / 3' }}>
        <Photo src={p.images[0]?.url} alt={p.name} className="w-full h-full" rounded={0} fallback={p.categoryIconKey ? <CategoryPlaceholder iconKey={p.categoryIconKey} className="w-full h-full" /> : undefined} />
      </div>
      {p.categoryName ? <p className="t-sub t-2 m-0">{p.categoryName}</p> : null}
      <h1 className="t-title1 t-display m-0 mt-1">{p.name}</h1>

      <PriceLine p={p} t={t} locale={locale} />

      {p.description ? <p className="t-body mt-4 mb-6" style={{ color: 'var(--c-ink-2)' }}>{p.description}</p> : <div className="h-6" />}

      {p.availability.length ? (
        <Group title={t('product.availability')} footer={stockShown ? t('common:stock.changesDuringDay') : t('product.askShop')}>
          {p.availability.map((a) => (
            <Row
              key={a.shopId}
              leading={<span className="icon-tile" style={{ background: 'var(--c-fill)', color: 'var(--c-ink-2)' }}><IconShop size={18} /></span>}
              title={a.shopName}
              trailing={
                a.state == null ? null
                  : a.qty != null && a.state !== 'out' ? <span className="t-sub t-2 tnum">{t('common:stock.qtyInStock', { count: a.qty })}</span>
                  : a.state === 'in' ? <span className="t-sub t-2">{t('common:stock.in')}</span>
                  : <StockBadge state={a.state} label={t(`common:stock.${a.state}`)} />
              }
            />
          ))}
        </Group>
      ) : null}

      {actions ?? (
        <div className="flex flex-col gap-3">
          {anyOut && notifyHref ? (
            <Link className="btn btn-primary btn-large" href={notifyHref}><IconBell size={20} />{t('product.notifyMe')}</Link>
          ) : null}
          {joinHref ? (
            <Link className={`btn btn-large ${anyOut && notifyHref ? 'btn-tinted' : 'btn-primary'}`} href={joinHref}>{t('product.join', { org: p.orgName })}</Link>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function PriceLine({ p, t, locale, small }: { p: PublicProduct; t: TFunction; locale: string; small?: boolean }) {
  // sold by weight, length or volume: the price is per kg, m or l, and says so
  const per = p.uom && p.uom !== 'piece' ? <span className="t-sub t-2 font-normal"> / {t(`common:uom.${p.uom}`)}</span> : null;
  if (p.offer) {
    return (
      <div className={small ? 'mt-1' : 'mt-3'}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`${small ? 't-headline' : 't-title2'} tnum`} style={{ color: 'var(--c-accent)' }}>{money(p.offer.priceMinor, p.currency, locale)}{per}</span>
          {p.offer.wasMinor != null ? <s className="t-sub t-2 tnum">{money(p.offer.wasMinor, p.currency, locale)}</s> : null}
          <span className="badge badge-accent">{t('common:postKind.offer')}</span>
        </div>
        {!small ? (
          <p className="t-foot t-2 mt-1 mb-0">
            {t('product.wasNote')}
            {p.offer.validUntil ? ` ${t('product.until', { date: date(p.offer.validUntil, locale, { weekday: 'long', day: 'numeric', month: 'long' }, p.timezone) })}` : ''}
          </p>
        ) : null}
      </div>
    );
  }
  if (p.priceMinor == null) return small ? null : <p className="t-sub t-2 mt-3 mb-0">{t('product.priceInShop')}</p>;
  return <p className={`${small ? 't-headline mt-1' : 't-title2 mt-3'} tnum mb-0`}>{money(p.priceMinor, p.currency, locale)}{per}</p>;
}
