'use client';

import { useState } from 'react';
import type { AuditEntry } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Avatar, Empty, Group, Row, Why } from '@/components/ui/kit';
import { IconHistory } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { dateTime } from '@/lib/format';

// who changed what. access, prices, exports, erasures and support access all land here.
export default function AuditPage() {
  const { api, org, t, locale, can } = useAdmin();
  const allowed = can('org.audit.view', null);
  const first = useAsync(() => (allowed ? api.audit(org.orgId) : Promise.resolve(null)), [allowed]);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? first.data?.nextCursor ?? null : cursor;

  if (!allowed) return <Page title={t('audit.title')}><Why>{t('common:error.forbidden')}</Why></Page>;
  const items = [...(first.data?.items ?? []), ...more];

  async function loadMore() {
    if (!next) return;
    const page = await api.audit(org.orgId, next);
    setMore((x) => [...x, ...page.items]);
    setCursor(page.nextCursor);
  }

  const label = (e: AuditEntry) => t(`audit.action.${e.action}`, { defaultValue: e.action.replace(/[._]/g, ' ') });
  const detail = (e: AuditEntry) => {
    const parts: string[] = [];
    if (e.before && typeof e.before === 'object') parts.push(`${t('audit.before')}: ${short(e.before)}`);
    if (e.after && typeof e.after === 'object') parts.push(`${t('audit.after')}: ${short(e.after)}`);
    return parts.join(' · ');
  };

  return (
    <Page title={t('audit.title')} subtitle={t('audit.lead')}>
      {first.data && !items.length ? <Empty icon={<IconHistory size={40} />} title={t('audit.emptyTitle')} /> : null}
      <Group footer={next ? <button type="button" className="btn btn-plain" onClick={() => void loadMore()}>{t('audit.more')}</button> : items.length ? t('audit.end') : undefined}>
        {items.map((e) => (
          <Row key={e.id} leading={<Avatar name={e.actorName ?? t('audit.system')} size={32} />}
            title={<span><span style={{ fontWeight: 600 }}>{e.actorName ?? t('audit.system')}</span> {label(e)}</span>}
            subtitle={[dateTime(e.createdAt, locale), e.entityType ? `${e.entityType}` : null, detail(e)].filter(Boolean).join(' · ')} />
        ))}
      </Group>
    </Page>
  );
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
}
