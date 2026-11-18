'use client';

// everything a super admin did: businesses created, owners and super admins invited, switches
// changed, and every action inside a business, newest first.

import { useState } from 'react';
import type { PlatformAuditEntry } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Empty, Group, Row } from '@/components/ui/kit';
import { IconHistory } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { dateTime } from '@/lib/format';
import { auditDetail, platformAuditLabel } from '@/lib/audit-text';

export default function PlatformAuditPage() {
  return (
    <PlatformShell>
      <AuditList />
    </PlatformShell>
  );
}

function AuditList() {
  const { api, t, locale } = usePlatform();
  const first = useAsync(() => api.platformAudit(), []);
  const [more, setMore] = useState<PlatformAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const next = cursor === undefined ? first.data?.nextCursor ?? null : cursor;
  const items = [...(first.data?.items ?? []), ...more];

  const loadMore = async () => {
    if (!next) return;
    const p = await api.platformAudit(next);
    setMore((m) => [...m, ...p.items]);
    setCursor(p.nextCursor);
  };

  const label = (a: string) => platformAuditLabel(t, a, locale);
  const detail = (d: unknown): string => {
    const o = d && typeof d === 'object' ? (d as { before?: unknown; after?: unknown }) : null;
    return o ? auditDetail(o.before, o.after, locale) : '';
  };

  return (
    <Page title={t('platform.audit.title')} back={{ href: '/admin/platform', label: t('platform.title') }} subtitle={t('platform.audit.sub')}>
      {!first.data ? <div className="h-64 rounded-[16px] skel" aria-busy="true" /> : !items.length ? (
        <Empty icon={<IconHistory size={28} />} title={t('platform.audit.emptyTitle')} body={t('platform.audit.emptyBody')} />
      ) : (
        <>
          <Group>
            {items.map((e) => (
              <Row key={e.id} chevron={false} title={label(e.action)}
                subtitle={[e.actorName ?? t('platform.audit.system'), e.orgName, detail(e.details), dateTime(e.createdAt, locale)].filter(Boolean).join(' · ')} />
            ))}
          </Group>
          {next ? <div className="flex justify-center mt-4"><button type="button" className="btn btn-gray" onClick={() => void loadMore()}>{t('platform.audit.more')}</button></div> : null}
        </>
      )}
    </Page>
  );
}
