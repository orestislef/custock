'use client';

// news and offers from this business, newest first. people who follow it see everything that was
// sent to the shops they follow. a business that shows its posts to everyone (policy catalog.news)
// shows visitors those too, with a soft invite to follow; otherwise everyone else is invited in.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FeedItem } from '@custock/core';
import { Photo } from '@/components/ui/client-kit';
import { Empty } from '@/components/ui/kit';
import { IconNews } from '@/components/ui/icons';
import { date, money } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n-client';
import { postText } from '@/lib/names';
import { SignInCard } from './sign-in';
import { useShopper } from './shopper-context';

export function NewsView() {
  const t = useT();
  const { api, status, follow, me, orgName, joinCode, slug } = useShopper();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  // for a visitor or someone who does not follow: the posts shown to everyone. undefined while
  // loading, null when the business keeps them for its followers
  const [open, setOpen] = useState<FeedItem[] | null | undefined>(undefined);
  // ?post=<id> from a notification: that post, scrolled to and marked
  const focus = useSearchParams().get('post');

  useEffect(() => {
    if (!follow) return;
    void api.feed().then((page) => setItems(page.items.filter((i) => i.post.orgId === follow.orgId)), () => setItems([]));
  }, [api, follow]);

  useEffect(() => {
    if (status === 'loading' || follow) return;
    let alive = true;
    void api.publicPosts(slug).then((p) => { if (alive) setOpen(p.items); }, () => { if (alive) setOpen(null); });
    return () => { alive = false; };
  }, [api, slug, status, follow]);

  const shown = follow ? items : open;
  useEffect(() => {
    if (!focus || !shown) return;
    document.getElementById(`post-${focus}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [focus, shown]);

  if (status === 'loading') return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (!follow && open === undefined) return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (!follow && open) {
    return (
      <>
        <div className="card p-4 mb-5 flex flex-col gap-3">
          <div>
            <p className="t-headline m-0">{t('shopper.news.visitorTitle')}</p>
            <p className="t-sub t-2 m-0 mt-1">{t('shopper.news.visitorBody', { org: orgName })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {joinCode ? <Link href={`/j/${joinCode}`} className="btn btn-primary">{t('shopper.news.visitorFollow', { org: orgName })}</Link> : null}
            {status === 'signedOut' ? <Link href={`/s/${slug}/me`} className="btn btn-plain">{t('shopper.signIn.already')}</Link> : null}
          </div>
        </div>
        <PostList items={open} focus={focus} />
      </>
    );
  }
  if (status === 'signedOut') return <SignInCard title={t('shopper.news.signInTitle')} lead={t('shopper.news.signInLead', { org: orgName })} />;
  if (!follow) {
    return (
      <Empty icon={<IconNews size={40} />} title={t('shopper.news.notFollowingTitle', { org: orgName })} body={t('shopper.news.notFollowingBody')}
        action={joinCode ? <Link href={`/j/${joinCode}`} className="btn btn-primary">{t('catalog.joinToBrowse', { org: orgName })}</Link> : undefined} />
    );
  }
  if (!items) return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  const first = me?.user.displayName?.split(' ')[0];
  return (
    <>
      {first ? <p className="t-body t-2 mt-0 mb-5">{t('shopper.news.hello', { name: first })}</p> : null}
      <PostList items={items} focus={focus} />
    </>
  );
}

function PostList({ items, focus }: { items: FeedItem[]; focus: string | null }) {
  const t = useT();
  const { orgName } = useShopper();
  return (
    <>
      {/* a notification for a post that was taken down since: one quiet line, the news as usual */}
      {focus && !items.some((i) => i.post.id === focus) ? <p className="t-sub t-2 mt-0 mb-4" role="status">{t('gone.shopPost')}</p> : null}
      {items.length ? (
        <ul className="list-none p-0 m-0 flex flex-col gap-4">
          {items.map((it) => <li key={it.post.id} id={`post-${it.post.id}`} style={{ scrollMarginTop: 72 }}><PostCard item={it} focused={it.post.id === focus} /></li>)}
        </ul>
      ) : (
        <Empty icon={<IconNews size={40} />} title={t('shopper.news.emptyTitle')} body={t('shopper.news.emptyBody', { org: orgName })} />
      )}
    </>
  );
}

function PostCard({ item, focused }: { item: FeedItem; focused?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const { slug } = useShopper();
  const p = item.post;
  const text = postText(p, locale);
  const when = p.sentAt ?? p.createdAt;
  return (
    <article className="card overflow-hidden" style={focused ? { boxShadow: '0 0 0 2px var(--c-accent)' } : undefined}>
      {p.coverUrl ? (
        <div style={{ aspectRatio: '16 / 9' }}><Photo src={p.coverUrl} alt="" className="w-full h-full" rounded={0} /></div>
      ) : null}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`badge ${p.kind === 'offer' ? 'badge-accent' : 'badge-gray'}`}>{t(`common:postKind.${p.kind}`)}</span>
          <span className="t-foot t-2">{item.shopNames.length ? `${item.shopNames.join(', ')} · ` : ''}{date(when, locale)}</span>
        </div>
        <h2 className="t-title3 m-0">{text.title}</h2>
        {text.body ? <p className="t-body mt-2 mb-0 whitespace-pre-line" style={{ color: 'var(--c-ink-2)' }}>{text.body}</p> : null}
        {p.products.length ? (
          <ul className="list mt-4" role="list" style={{ background: 'var(--c-shelf)' }}>
            {p.products.map((x) => (
              <li key={x.variantId}>
                <Link href={`/s/${slug}/p/${x.productId}?from=news`} className="row has-icon">
                  <Photo src={x.imageUrl} alt={x.name} size={40} />
                  <span className="row-main"><span className="row-title block truncate">{x.name}</span></span>
                  {x.offerPriceMinor != null ? (
                    <span className="flex flex-col items-end">
                      <span className="t-headline tnum" style={{ color: 'var(--c-accent)' }}>{money(x.offerPriceMinor, 'EUR', locale)}</span>
                      {x.wasMinor != null ? <s className="t-foot t-2 tnum">{money(x.wasMinor, 'EUR', locale)}</s> : null}
                    </span>
                  ) : x.priceMinor != null ? <span className="t-sub tnum">{money(x.priceMinor, 'EUR', locale)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {p.validUntil ? <p className="t-foot t-2 m-0 mt-3">{t('shopper.news.endsOn', { date: date(p.validUntil, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p> : null}
      </div>
    </article>
  );
}
