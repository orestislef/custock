'use client';

// one error: what happened, where, how often, the newest example with its stack, and what to do
// with it (resolve, ignore, open again). "Copy for a bug report" puts a clean text block on the
// clipboard, already scrubbed like everything the tracker keeps.

import { use, useEffect, useState } from 'react';
import type { IssueDetail, IssueStatus } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Empty, Group, Row } from '@/components/ui/kit';
import { useToast } from '@/components/ui/client-kit';
import { IconCheck, IconCopy, IconSlash, IconWarning } from '@/components/ui/icons';
import { dateTime, relative } from '@/lib/format';

export default function PlatformErrorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PlatformShell>
      <ErrorDetail id={id} />
    </PlatformShell>
  );
}

// a plain text block for a bug report. english on purpose: it goes next to the code
function reportText(i: IssueDetail): string {
  const e = i.example;
  const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lines = [
    `Custock error (${i.kind})`,
    `Title: ${i.title}`,
    e.message !== i.title ? `Message: ${e.message}` : null,
    i.route || e.method ? `Where: ${[e.method, i.route].filter(Boolean).join(' ')}` : null,
    e.status ? `Status: ${e.status}` : null,
    i.frame ? `Code: ${i.frame}` : null,
    `Seen: ${i.count} times, first ${iso(i.firstSeen)}, last ${iso(i.lastSeen)}`,
    `State: ${i.status}`,
    e.release ? `Server version: ${e.release}` : null,
    e.build ? `App version: ${e.build}` : null,
    e.browser || e.os ? `Browser: ${[e.browser, e.os].filter(Boolean).join(' on ')}` : null,
    i.orgName || e.orgId ? `Business: ${[i.orgName, e.orgId ? `(${e.orgId})` : null].filter(Boolean).join(' ')}` : null,
    e.userId ? `Person id: ${e.userId}` : null,
    e.requestId ? `Request id: ${e.requestId}` : null,
    e.stack ? `\nStack:\n${e.stack}` : null,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function ErrorDetail({ id }: { id: string }) {
  const { api, t, locale } = usePlatform();
  const toast = useToast();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.platformError(id).then((d) => { if (live) setIssue(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, id]);

  const set = async (status: IssueStatus) => {
    if (!issue) return;
    setBusy(true);
    try {
      const next = await api.setPlatformErrorStatus(issue.id, status);
      setIssue({ ...issue, ...next });
      toast(t(`issues.toast.${status}`));
    } catch {
      toast(t('common:error.internal'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issue) return;
    try {
      await navigator.clipboard.writeText(reportText(issue));
      toast(t('issues.copied'));
    } catch {
      toast(t('common:error.internal'));
    }
  };

  const back = { href: '/admin/platform/errors', label: t('issues.title') };

  if (failed) {
    return (
      <Page title={t('issues.title')} back={back}>
        <Empty icon={<IconWarning size={28} />} title={t('issues.gone')} />
      </Page>
    );
  }
  if (!issue) {
    return (
      <Page title={t('issues.title')} back={back}>
        <div className="h-64 rounded-[16px] skel" aria-busy="true" />
      </Page>
    );
  }

  const e = issue.example;
  const facts: { label: string; value: string | null }[] = [
    { label: t('issues.detail.where'), value: [e.method, issue.route].filter(Boolean).join(' ') || null },
    { label: t('issues.detail.status'), value: e.status ? String(e.status) : null },
    { label: t('issues.detail.frame'), value: issue.frame },
    { label: t('issues.detail.business'), value: issue.orgName ?? e.orgId },
    { label: t('issues.detail.user'), value: e.userId },
    { label: t('issues.detail.device'), value: [e.browser, e.os].filter(Boolean).join(' · ') || null },
    { label: t('issues.detail.release'), value: e.release },
    { label: t('issues.detail.build'), value: e.build },
    { label: t('issues.detail.request'), value: e.requestId },
  ];

  return (
    <Page title={t(`issues.kind.${issue.kind}`)} back={back}
      subtitle={[t('issues.times', { count: issue.count }), t('issues.lastSeen', { when: relative(issue.lastSeen, locale) })].join(' · ')}
      actions={<button type="button" className="btn btn-gray" onClick={() => void copy()}><IconCopy size={18} />{t('issues.copy')}</button>}>

      <div className="card p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className={`badge ${issue.status === 'open' ? 'badge-neg' : issue.status === 'resolved' ? 'badge-ok' : 'badge-gray'}`}>{t(`issues.status.${issue.status}`)}</span>
        </div>
        <p className="t-headline m-0" style={{ overflowWrap: 'anywhere' }}>{issue.title}</p>
        {e.message !== issue.title ? <p className="t-sub t-2 m-0 mt-2" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{e.message}</p> : null}
        {issue.status !== 'open' ? <p className="t-foot t-2 m-0 mt-3">{t(issue.status === 'resolved' ? 'issues.resolvedNote' : 'issues.ignoredNote')}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="min-w-0 flex flex-col gap-6">
          <Group title={t('issues.detail.what')}>
            {facts.filter((f) => f.value).map((f) => (
              <Row key={f.label} chevron={false} title={f.label} subtitle={<span style={{ overflowWrap: 'anywhere' }}>{f.value}</span>} />
            ))}
            <Row chevron={false} title={t('issues.detail.firstSeen')} value={dateTime(issue.firstSeen, locale)} />
            <Row chevron={false} title={t('issues.detail.lastSeen')} value={dateTime(issue.lastSeen, locale)} />
          </Group>

          <section aria-labelledby="stack-h">
            <h2 id="stack-h" className="t-foot t-2 m-0 mb-2 px-4" style={{ fontWeight: 400 }}>{t('issues.detail.stack')}</h2>
            {e.stack ? (
              <pre className="card p-4 m-0 overflow-x-auto t-foot" tabIndex={0} aria-label={t('issues.detail.stack')}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre' }}>{e.stack}</pre>
            ) : (
              <p className="t-sub t-2 px-4 m-0">{t('issues.detail.noStack')}</p>
            )}
          </section>
        </div>

        <div className="min-w-0 flex flex-col gap-3">
          <Group footer={t('issues.actionsFoot')}>
            {issue.status !== 'resolved' ? (
              <Row onClick={busy ? undefined : () => void set('resolved')} chevron={false} disabled={busy}
                leading={<span className="icon-tile" style={{ color: 'var(--c-success)' }}><IconCheck size={18} /></span>} title={t('issues.resolve')} />
            ) : null}
            {issue.status !== 'ignored' ? (
              <Row onClick={busy ? undefined : () => void set('ignored')} chevron={false} disabled={busy}
                leading={<span className="icon-tile"><IconSlash size={18} /></span>} title={t('issues.ignore')} />
            ) : null}
            {issue.status !== 'open' ? (
              <Row onClick={busy ? undefined : () => void set('open')} chevron={false} disabled={busy}
                leading={<span className="icon-tile"><IconWarning size={18} /></span>} title={t('issues.reopen')} />
            ) : null}
          </Group>
        </div>
      </div>
    </Page>
  );
}
