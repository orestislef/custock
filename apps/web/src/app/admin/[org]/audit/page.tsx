'use client';

import Link from '@/components/admin/org-link';
import { useState } from 'react';
import type { AuditEntry } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Empty } from '@/components/ui/kit';
import { IconHistory } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { auditDetail, auditVerb } from '@/lib/audit-text';
import { useNames } from '@/lib/use-names';
import { dateTime, money } from '@/lib/format';
import { RedirectHome } from '@/components/admin/redirect-home';

// who changed what, as sentences people can read. the raw record stays in the api.
const SETTING_LABEL: Record<string, string> = {
  posts_need_approval: 'settings.approval', postsNeedApproval: 'settings.approval',
  allow_negative_stock: 'settings.negative', allowNegativeStock: 'settings.negative',
  customer_prices: 'settings.prices', customerPrices: 'settings.prices',
  customer_catalog: 'settings.catalog', customerCatalog: 'settings.catalog',
  customer_stock: 'settings.stock', customerStock: 'settings.stock',
  push_daily_cap: 'settings.cap', pushDailyCap: 'settings.cap',
  quiet_hours: 'settings.quiet', quietHours: 'settings.quiet',
};
const MODE_LABEL: Record<string, string> = {
  customer_catalog: 'settings.catalogMode', customerCatalog: 'settings.catalogMode',
  customer_stock: 'settings.stockMode', customerStock: 'settings.stockMode',
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' ? (v as Obj) : null);
const priceOf = (o: Obj | null) => (o ? (o.price_minor ?? o.priceMinor ?? o.price ?? o.price_override_minor ?? o.priceOverrideMinor) : undefined) as number | undefined;

export default function AuditPage() {
  const { api, org, t, locale, can } = useAdmin();
  const allowed = can('org.audit.view', null);
  const names = useNames(api, org.orgId, locale);
  const first = useAsync(() => (allowed ? api.audit(org.orgId) : Promise.resolve(null)), [allowed]);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? first.data?.nextCursor ?? null : cursor;

  if (!allowed) return <RedirectHome />;
  const items = [...(first.data?.items ?? []), ...more];

  async function loadMore() {
    if (!next) return;
    const page = await api.audit(org.orgId, next);
    setMore((x) => [...x, ...page.items]);
    setCursor(page.nextCursor);
  }

  const entityName = (e: AuditEntry): string => {
    if (!e.entityId) return '';
    if (e.entityType === 'product') return names.product(e.entityId);
    if (e.entityType === 'product_variant' || e.entityType === 'variant') return names.variant(e.entityId);
    return auditDetail(e.before, e.after, locale);
  };

  const href = (e: AuditEntry): string | null => {
    if (!e.entityId) return null;
    switch (e.entityType) {
      case 'product': return `/admin/stock/${e.entityId}`;
      case 'product_variant': case 'variant': { const p = names.productOfVariant(e.entityId); return p ? `/admin/stock/${p.id}` : null; }
      case 'post': return `/admin/posts/${e.entityId}`;
      case 'customer': return `/admin/customers/${e.entityId}`;
      case 'stock_count': case 'count': return `/admin/stock/counts/${e.entityId}`;
      case 'transfer': return `/admin/stock/transfers/${e.entityId}`;
      case 'role': return `/admin/team/roles/${e.entityId}`;
      case 'membership': case 'member': case 'invite': return '/admin/team';
      case 'organization': case 'org': case 'shop': return '/admin/settings';
      case 'category': return '/admin/stock/categories';
      case 'join_link': return '/admin/join-links';
      default: return null;
    }
  };

  const sentence = (e: AuditEntry): string => {
    const actor = e.actorName ?? t('audit.system');
    const name = entityName(e);
    if (e.action === 'product.price_changed' || e.action === 'product.shop_price_changed') {
      const from = priceOf(asObj(e.before)), to = priceOf(asObj(e.after));
      if (to != null) {
        return t('audit.s.priceChanged', { actor, name: name || t('audit.aProduct'), from: from != null ? money(from, org.currency, locale) : '?', to: money(to, org.currency, locale) });
      }
    }
    if (e.action === 'org.settings_changed' || e.action === 'settings.changed') {
      const before = asObj(e.before) ?? {}, after = asObj(e.after) ?? {};
      const parts = Object.keys(after).filter((k) => SETTING_LABEL[k] && before[k] !== after[k]).map((k) => {
        const setting = t(SETTING_LABEL[k]!);
        const v = after[k];
        if (typeof v === 'boolean' || v === 0 || v === 1) return t(v ? 'audit.s.on' : 'audit.s.off', { setting });
        const value = MODE_LABEL[k] ? t(`${MODE_LABEL[k]}.${String(v)}`, { defaultValue: String(v) }) : String(v);
        return t('audit.s.set', { setting, value });
      });
      if (parts.length) return `${actor} ${parts.join(', ')}`;
    }
    const verb = auditVerb(t, e.action);
    return name ? t('audit.s.withName', { actor, verb, name }) : t('audit.s.plain', { actor, verb });
  };

  return (
    <Page title={t('audit.title')} subtitle={t('audit.lead')}>
      {first.data && !items.length ? <Empty icon={<IconHistory size={40} />} title={t('audit.emptyTitle')} /> : null}
      <section className="inset-group">
        <ul className="list" role="list">
          {items.map((e) => {
            const link = href(e);
            const inner = (
              <>
                <Avatar name={e.actorName ?? t('audit.system')} size={32} src={e.actorAvatarUrl} />
                <span className="row-main">
                  <span className="row-title block">{sentence(e)}</span>
                  <span className="row-sub block">{dateTime(e.createdAt, locale)}</span>
                </span>
              </>
            );
            return (
              <li key={e.id}>
                {link ? <Link href={link} className="row has-icon">{inner}</Link> : <div className="row has-icon">{inner}</div>}
              </li>
            );
          })}
        </ul>
        {next ? <p className="inset-group-foot"><button type="button" className="btn btn-plain" onClick={() => void loadMore()}>{t('audit.more')}</button></p>
          : items.length ? <p className="inset-group-foot">{t('audit.end')}</p> : null}
      </section>
    </Page>
  );
}
