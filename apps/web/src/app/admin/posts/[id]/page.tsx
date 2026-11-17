'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Group, Row, Segmented, Why } from '@/components/ui/kit';
import { Photo, useToast } from '@/components/ui/client-kit';
import { IconChevronLeft } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { dateTime, money, number, percent } from '@/lib/format';

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, org, t, locale, can, shops } = useAdmin();
  const toast = useToast();
  const post = useAsync(() => api.post(org.orgId, id), [id]);
  const groups = useAsync(() => api.groups(org.orgId), []);
  const [tab, setTab] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const p = post.data;
  if (!p) return <div className="pt-6"><div className="h-[220px] skel mb-4" style={{ borderRadius: 16 }} /></div>;

  const langs = Object.keys(p.translations) as Locale[];
  const cur = tab && p.translations[tab] ? tab : (p.translations[locale] ? (locale as Locale) : p.defaultLocale);
  const text = p.translations[cur] ?? { title: '', body: '' };
  const scopeName = (type: string, sid: string) => type === 'org' ? org.name : type === 'group' ? groups.data?.find((g) => g.id === sid)?.name ?? sid : shops.find((s) => s.id === sid)?.name ?? sid;

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); toast(msg); await post.reload(); } catch (e) { toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`)); } finally { setBusy(false); }
  }

  const s = p.stats;
  return (
    <div className="page-in pt-2 max-w-[760px]">
      <Link href="/admin/posts" className="inline-flex items-center min-h-[44px] -ml-2 t-body"><IconChevronLeft size={24} />{t('posts.title')}</Link>
      {p.coverUrl ? <div className="card mt-2 mb-5" style={{ aspectRatio: '16 / 9' }}><Photo src={p.coverUrl} alt={text.title} className="w-full h-full" rounded={0} /></div> : null}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="badge badge-accent">{t(`common:postKind.${p.kind}`)}</span>
        <span className="badge badge-gray">{t(`common:postStatus.${p.status}`)}</span>
        {langs.length > 1 ? <Segmented label={t('composer.language')} value={cur} onChange={setTab} options={langs.map((l) => ({ value: l, label: l.toUpperCase() }))} /> : null}
      </div>
      <h1 className="t-title1 t-display m-0">{text.title}</h1>
      <p className="t-body mt-3 mb-6 whitespace-pre-line" style={{ color: 'var(--c-ink-2)' }}>{text.body}</p>

      <div className="flex gap-2 flex-wrap mb-8">
        {p.status === 'pending_approval' && can('posts.publish', null) ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.approvePost(org.orgId, p.id), t('post.approved'))}>{t('post.approve')}</button>
        ) : null}
        {p.status === 'pending_approval' && !can('posts.publish', null) ? <Why>{t('post.waitingApproval')}</Why> : null}
        {p.status === 'draft' && can('posts.create', null) ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.publishPost(org.orgId, p.id), t('post.sentOff'))}>{can('posts.publish', null) ? t('composer.publish') : t('composer.submit')}</button>
        ) : null}
        {p.status === 'scheduled' && can('posts.publish', null) ? (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act(() => api.cancelPost(org.orgId, p.id), t('post.cancelled'))}>{t('post.cancel')}</button>
        ) : null}
        {can('posts.delete', null) ? (deleting ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span className="t-sub" style={{ color: 'var(--c-neg-text)' }}>{p.status === 'sent' ? t('post.deleteSent') : t('post.deleteConfirm')}</span>
            <button type="button" className="btn btn-danger" style={{ background: 'var(--c-neg-tint)' }} disabled={busy} onClick={() => void api.deletePost(org.orgId, p.id).then(() => { toast(t('post.deleted')); router.push('/admin/posts'); }).catch((e: { code?: string }) => toast(t(`common:error.${e.code ?? 'internal'}`)))}>{t('common:action.delete')}</button>
            <button type="button" className="btn btn-gray" onClick={() => setDeleting(false)}>{t('common:action.cancel')}</button>
          </span>
        ) : <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>{t('common:action.delete')}</button>) : null}
      </div>

      {s ? (
        <Group title={t('post.results')} footer={t('post.opensNote')}>
          <Row title={t('post.reached')} value={number(p.recipientsCount ?? 0, locale)} />
          <Row title={t('post.delivered')} value={number(s.sent, locale)} />
          <Row title={t('post.opened')} value={`${number(s.opened, locale)} · ${percent(s.sent ? s.opened / s.sent : 0, locale)}`} />
          <Row title={t('post.failed')} value={number(s.failed, locale)} />
          <Row title={t('post.skipped')} subtitle={t('post.skippedSub')} value={number(s.skipped, locale)} />
        </Group>
      ) : null}

      <Group title={t('post.details')}>
        <Row title={t('post.author')} value={p.authorName ?? ''} />
        <Row title={t('composer.audience')} value={p.audience.scopes.map((x) => scopeName(x.scopeType, x.scopeId)).join(', ')} />
        <Row title={t('composer.channels')} value={p.channels.map((c) => t(`common:channel.${c}`)).join(', ')} />
        {p.sentAt ? <Row title={t('post.sentAt')} value={dateTime(p.sentAt, locale)} /> : null}
        {p.scheduledAt ? <Row title={t('post.scheduledAt')} value={dateTime(p.scheduledAt, locale)} /> : null}
        {p.validUntil ? <Row title={t('composer.until')} value={dateTime(p.validUntil, locale)} /> : null}
      </Group>

      {p.products.length ? (
        <Group title={t('composer.products')} footer={p.kind === 'offer' ? t('composer.wasNote') : undefined}>
          {p.products.map((x) => (
            <Row key={x.variantId} href={`/admin/stock/${x.productId}`} leading={<Photo src={x.imageUrl} alt={x.name} size={40} />} title={x.name}
              value={x.offerPriceMinor != null ? (
                <span className="tnum"><span style={{ color: 'var(--c-accent)' }}>{money(x.offerPriceMinor, org.currency, locale)}</span> <s className="t-2">{money(x.wasMinor, org.currency, locale)}</s></span>
              ) : money(x.priceMinor, org.currency, locale)} />
          ))}
        </Group>
      ) : null}
    </div>
  );
}
