'use client';

// small pieces for the super admin screens: numbers, money per currency, storage sizes, the
// copy and share buttons for invite links, and the banners for pauses and storage warnings.

import Link from 'next/link';
import type { MeContext, MoneyByCurrency } from '@custock/core';
import type { TFunction } from '@custock/i18n';
import { useToast } from '@/components/ui/client-kit';
import { IconCopy, IconShare, IconWarning } from '@/components/ui/icons';
import { money, number, intlLocale } from '@/lib/format';

export function bytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: digits }).format(v)} ${units[i]}`;
}

export function moneyList(list: MoneyByCurrency, locale: string): string {
  if (!list.length) return money(0, 'EUR', locale);
  return list.map((m) => money(m.minor, m.currency, locale)).join(' · ');
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1 min-w-0">
      <span className="t-foot t-2 truncate">{label}</span>
      <span className="t-title2 t-display tnum truncate">{value}</span>
      {sub ? <span className="t-foot t-2 truncate">{sub}</span> : null}
    </div>
  );
}

// a filled bar for a share of a limit. red from 90, amber from 70
export function Meter({ percent, label }: { percent: number; label: string }) {
  const p = Math.max(0, Math.min(100, percent));
  const color = percent >= 90 ? 'var(--c-error)' : percent >= 70 ? 'var(--c-few-text)' : 'var(--c-accent)';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}
      className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-fill)' }}>
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: color, transition: 'width 600ms cubic-bezier(.32,.72,0,1)' }} />
    </div>
  );
}

export function LinkActions({ link, t, title }: { link: string; t: TFunction; title: string }) {
  const toast = useToast();
  return (
    <div className="flex gap-3 flex-wrap">
      <button type="button" className="btn btn-tinted" onClick={() => void navigator.clipboard.writeText(link).then(() => toast(t('links.copied')))}>
        <IconCopy size={18} />{t('team.copyLink')}
      </button>
      {typeof navigator !== 'undefined' && 'share' in navigator ? (
        <button type="button" className="btn btn-gray" onClick={() => void navigator.share({ title, url: link }).catch(() => {})}>
          <IconShare size={18} />{t('common:action.share')}
        </button>
      ) : null}
    </div>
  );
}

export function Banner({ tone = 'warn', children, action }: { tone?: 'warn' | 'stop'; children: React.ReactNode; action?: React.ReactNode }) {
  const bg = tone === 'stop' ? 'var(--c-neg-tint)' : 'var(--c-few-tint)';
  const fg = tone === 'stop' ? 'var(--c-neg-text)' : 'var(--c-few-text)';
  return (
    <div role="status" className="flex items-start gap-3 rounded-[12px] px-4 py-3 mb-3" style={{ background: bg, color: fg }}>
      <IconWarning size={20} className="flex-none mt-0.5" />
      <p className="t-sub m-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

// what a super admin must not miss: platform pauses that are on, photo storage filling up
export function PlatformBanners({ me, t }: { me: MeContext; t: TFunction }) {
  if (me.platformRole !== 'superadmin') return null;
  const paused = me.platformPaused ?? [];
  const pct = me.storagePercent ?? 0;
  if (!paused.length && pct < 70) return null;
  return (
    <div className="pt-3">
      {paused.length ? (
        <Banner tone="stop" action={<Link className="t-sub" href="/admin/platform#switches" style={{ color: 'inherit', fontWeight: 600 }}>{t('platform.banner.review')}</Link>}>
          {t('platform.banner.paused', { list: paused.map((k) => t(`platform.switch.${k}.short`)).join(', ') })}
        </Banner>
      ) : null}
      {pct >= 70 ? (
        <Banner tone={pct >= 90 ? 'stop' : 'warn'} action={<Link className="t-sub" href="/admin/platform#storage" style={{ color: 'inherit', fontWeight: 600 }}>{t('platform.banner.review')}</Link>}>
          {t(pct >= 90 ? 'platform.banner.storage90' : 'platform.banner.storage70', { pct: Math.floor(pct) })}
        </Banner>
      ) : null}
    </div>
  );
}

export { number };
