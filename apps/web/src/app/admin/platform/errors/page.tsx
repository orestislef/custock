'use client';

// errors seen in production, for a super admin: open issues first, newest first, each with how
// often it happened and when last. filter by state and kind, search, open one for its details.

import { useEffect, useState } from 'react';
import type { Issue, IssueKind, IssuePage, IssueStatus } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Chips, Empty, Group, Row, Segmented } from '@/components/ui/kit';
import { IconCheck, IconSearch, IconWarning } from '@/components/ui/icons';
import { relative } from '@/lib/format';
import type { TFunction } from '@custock/i18n';

const KINDS: IssueKind[] = ['api', 'worker', 'send', 'storage', 'client'];
type StatusFilter = IssueStatus | 'all';

export default function PlatformErrorsPage() {
  return (
    <PlatformShell>
      <ErrorList />
    </PlatformShell>
  );
}

function issueSubtitle(i: Issue, t: TFunction, locale: string): string {
  return [t(`issues.kind.${i.kind}`), i.route, t('issues.times', { count: i.count }), t('issues.lastSeen', { when: relative(i.lastSeen, locale) })]
    .filter(Boolean)
    .join(' · ');
}

function ErrorList() {
  const { api, t, locale } = usePlatform();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [kind, setKind] = useState<IssueKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  const [page, setPage] = useState<IssuePage | null>(null);
  const [failed, setFailed] = useState(false);

  // search waits for a short pause in typing
  useEffect(() => {
    const id = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let live = true;
    api.platformErrors({ status, kind: kind === 'all' ? undefined : kind, q: needle || undefined })
      .then((p) => { if (live) { setPage(p); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, status, kind, needle]);

  const more = async () => {
    if (!page?.nextCursor) return;
    const next = await api.platformErrors({ status, kind: kind === 'all' ? undefined : kind, q: needle || undefined, cursor: page.nextCursor });
    setPage({ ...next, items: [...page.items, ...next.items] });
  };

  const counts = page?.counts;
  const filtered = status !== 'open' || kind !== 'all' || !!needle;

  return (
    <Page title={t('issues.title')} back={{ href: '/admin/platform', label: t('platform.title') }} subtitle={t('issues.sub')}>
      <div className="flex flex-col gap-3 mb-4">
        <Segmented<StatusFilter>
          label={t('issues.title')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: counts ? `${t('issues.status.open')} ${counts.open}` : t('issues.status.open') },
            { value: 'resolved', label: t('issues.status.resolved') },
            { value: 'ignored', label: t('issues.status.ignored') },
            { value: 'all', label: t('issues.status.all') },
          ]}
        />
        <Chips<IssueKind | 'all'>
          label={t('issues.kind.all')}
          value={kind}
          onChange={setKind}
          options={[{ value: 'all', label: t('issues.kind.all') }, ...KINDS.map((k) => ({ value: k, label: t(`issues.kind.${k}`) }))]}
        />
        <label className="flex items-center gap-2 px-3 rounded-[10px]" style={{ background: 'var(--c-fill)', minHeight: 40 }}>
          <IconSearch size={18} className="t-2" />
          <span className="sr-only">{t('issues.search')}</span>
          <input className="flex-1 bg-transparent border-0 outline-none t-body" style={{ fontSize: 16 }} type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={200} aria-label={t('issues.search')} placeholder={t('issues.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {failed ? (
        <Empty icon={<IconWarning size={28} />} title={t('issues.loadFailed')} />
      ) : !page ? (
        <div className="h-64 rounded-[16px] skel" aria-busy="true" />
      ) : !page.items.length ? (
        filtered
          ? <p className="t-sub t-2 px-4">{t('issues.noMatch')}</p>
          : <Empty icon={<IconCheck size={28} />} title={t('issues.emptyTitle')} body={t('issues.emptyBody')} />
      ) : (
        <>
          <Group>
            {page.items.map((i) => (
              <Row key={i.id} href={`/admin/platform/errors/${i.id}`}
                leading={<span className="icon-tile" style={i.status === 'open' ? { color: 'var(--c-neg-text)', background: 'var(--c-neg-tint)' } : undefined}><IconWarning size={18} /></span>}
                title={<span className="inline-flex items-center gap-2 min-w-0 max-w-full"><span className="truncate">{i.title}</span>{i.status !== 'open' ? <span className="badge badge-gray flex-none">{t(`issues.status.${i.status}`)}</span> : null}</span>}
                subtitle={issueSubtitle(i, t, locale)} />
            ))}
          </Group>
          {page.nextCursor ? (
            <div className="flex justify-center mt-4"><button type="button" className="btn btn-gray" onClick={() => void more()}>{t('issues.more')}</button></div>
          ) : null}
        </>
      )}
    </Page>
  );
}
