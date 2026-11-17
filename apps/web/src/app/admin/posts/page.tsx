'use client';

import Link from 'next/link';
import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PostStatus } from '@custock/core';
import { useAdmin } from '@/components/admin/admin-context';
import { Page } from '@/components/admin/shell';
import { Chips, Empty } from '@/components/ui/kit';
import { Photo, isMac, useShortcuts } from '@/components/ui/client-kit';
import { IconMegaphone, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { postText } from '@/lib/names';
import { relative, number } from '@/lib/format';

type F = 'all' | 'draft' | 'pending_approval' | 'scheduled' | 'sent';

export default function PostsPage() {
  return <Suspense><Posts /></Suspense>;
}

function statusBadge(s: PostStatus) {
  return s === 'sent' ? 'badge-ok' : s === 'pending_approval' ? 'badge-few' : s === 'scheduled' ? 'badge-info' : s === 'cancelled' || s === 'failed' ? 'badge-out' : 'badge-gray';
}

function Posts() {
  const { api, org, t, locale, can } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState<F>((params.get('status') as F) ?? 'all');
  const list = useAsync(() => api.posts(org.orgId, f === 'all' ? undefined : { status: f }), [f]);
  const canCreate = can('posts.create', null);
  useShortcuts({ create: useCallback(() => { if (canCreate) router.push('/admin/posts/new'); }, [canCreate, router]) });
  const items = list.data?.items ?? [];

  return (
    <Page
      title={t('posts.title')}
      actions={can('posts.create', null) ? <Link href="/admin/posts/new" className="btn btn-primary" title={`${t('posts.new')} (${isMac() ? '⌘' : 'Ctrl+'}N)`}><IconPlus size={18} />{t('posts.new')}</Link> : null}
      phoneAction={can('posts.create', null) ? <Link href="/admin/posts/new" className="icon-btn" style={{ background: 'var(--c-accent-tint)' }} aria-label={t('posts.new')}><IconPlus size={22} /></Link> : undefined}
    >
      <div className="mb-5 overflow-x-auto">
        <Chips label={t('posts.filter')} value={f} onChange={(v) => { setF(v); router.replace(v === 'all' ? '/admin/posts' : `/admin/posts?status=${v}`); }}
          options={(['all', 'draft', 'pending_approval', 'scheduled', 'sent'] as F[]).map((v) => ({ value: v, label: v === 'all' ? t('posts.all') : t(`common:postStatus.${v}`) }))} />
      </div>

      {list.data && !items.length ? (
        <Empty icon={<IconMegaphone size={40} />} title={t('posts.emptyTitle')} body={t('posts.emptyBody')}
          action={can('posts.create', null) ? <Link href="/admin/posts/new" className="btn btn-tinted">{t('posts.new')}</Link> : undefined} />
      ) : (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 list-none p-0 m-0">
          {items.map((p) => {
            const text = postText(p, locale);
            return (
              <li key={p.id}>
                <Link href={`/admin/posts/${p.id}`} className="card block h-full hover:no-underline" style={{ color: 'var(--c-ink)' }}>
                  <div style={{ aspectRatio: '16 / 9', background: 'var(--c-fill)' }}>
                    {p.coverUrl ? <Photo src={p.coverUrl} alt={text.title} className="w-full h-full" rounded={0} /> : (
                      <div className="w-full h-full grid place-items-center" style={{ color: 'var(--c-ink-3)' }}><IconMegaphone size={36} /></div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="eyebrow flex-1">{t(`common:postKind.${p.kind}`)}</span>
                      <span className={`badge ${statusBadge(p.status)}`}>{t(`common:postStatus.${p.status}`)}</span>
                    </div>
                    <p className="t-headline m-0 line-clamp-2">{text.title}</p>
                    <p className="t-sub t-2 m-0 mt-1 line-clamp-2">{text.body}</p>
                    <p className="t-foot t-2 m-0 mt-3">
                      {p.authorName} · {relative(p.sentAt ?? p.scheduledAt ?? p.createdAt, locale)}
                      {p.recipientsCount ? ` · ${t('posts.reached', { count: p.recipientsCount, n: number(p.recipientsCount, locale) })}` : ''}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
