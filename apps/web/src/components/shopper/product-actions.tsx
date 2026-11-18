'use client';

// what a signed in follower can do on a product: save it, and ask to hear when it is back. the
// first "tell me" is also the moment to offer notifications, never before.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicProduct } from '@custock/core';
import { ProductView } from '@/components/public/product-view';
import { Empty } from '@/components/ui/kit';
import { IconBell, IconBox, IconCheck, IconHeart } from '@/components/ui/icons';
import { useToast } from '@/components/ui/client-kit';
import { useLocale, useT } from '@/lib/i18n-client';
import { PushNudge } from './push-nudge';
import { useShopper } from './shopper-context';
import { Gone } from '@/components/ui/gone';

export function ProductActions({ p, joinHref }: { p: PublicProduct; joinHref: string | null }) {
  const t = useT();
  const toast = useToast();
  const { api, slug, status, follow } = useShopper();
  const [mine, setMine] = useState<PublicProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const anyOut = p.availability.some((a) => a.state === 'out');

  useEffect(() => {
    if (!follow) return;
    void api.publicProduct(slug, p.id).then(setMine, () => setMine(null));
  }, [api, slug, p.id, follow]);

  if (status !== 'signedIn' || !follow) {
    if (status === 'loading') return <div className="h-[50px]" />;
    return (
      <div className="flex flex-col gap-3">
        {anyOut && joinHref ? <Link className="btn btn-primary btn-large" href={`${joinHref}?notify=${encodeURIComponent(p.name)}`}><IconBell size={20} />{t('product.notifyMe')}</Link> : null}
        {joinHref ? <Link className={`btn btn-large ${anyOut ? 'btn-tinted' : 'btn-primary'}`} href={joinHref}>{t('product.join', { org: p.orgName })}</Link> : null}
        {status === 'signedOut' ? <Link className="btn btn-plain" href={`/s/${slug}/me`}>{t('shopper.signIn.already')}</Link> : null}
      </div>
    );
  }

  const saved = mine?.saved ?? false;
  const waiting = (mine?.waitingForIt ?? false) || asked;

  const toggleSave = async () => {
    setBusy(true);
    try {
      await api.setFavorite(p.id, !saved);
      setMine((m) => (m ? { ...m, saved: !saved } : m));
      toast(!saved ? t('shopper.product.savedToast') : t('shopper.product.unsavedToast'));
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  const notify = async () => {
    setBusy(true);
    try {
      await api.notifyMe(p.variantId, null);
      setAsked(true);
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {anyOut ? (
        waiting ? (
          <p className="card p-4 m-0 t-sub flex gap-3 items-start" role="status">
            <IconCheck size={20} className="flex-none" style={{ color: 'var(--c-success)' }} />
            <span>{t('shopper.product.notifySet')}</span>
          </p>
        ) : (
          <button type="button" className="btn btn-primary btn-large" disabled={busy} onClick={() => void notify()}><IconBell size={20} />{t('product.notifyMe')}</button>
        )
      ) : null}
      {asked ? <PushNudge /> : null}
      <button type="button" className="btn btn-tinted btn-large" aria-pressed={saved} disabled={busy || !mine} onClick={() => void toggleSave()}>
        <IconHeart size={20} filled={saved} />{saved ? t('shopper.product.saved') : t('shopper.product.save')}
      </button>
    </div>
  );
}

// a business that shows products to followers only: the page loads them with the session
export function FollowerProduct({ id, joinHref }: { id: string; joinHref: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { api, slug, status, follow, orgName } = useShopper();
  const [p, setP] = useState<PublicProduct | null | undefined>(undefined);
  useEffect(() => {
    if (!follow) return;
    void api.publicProduct(slug, id).then(setP, () => setP(null));
  }, [api, slug, id, follow]);
  if (status === 'loading' || (follow && p === undefined)) return <div className="h-64 rounded-[16px] skel" aria-busy="true" />;
  // a follower opening a product the shop took off the shelf (an old notification, a saved link)
  if (follow && p === null) {
    return <Gone title={t('gone.shopProduct.title')} body={t('gone.shopProduct.body', { org: orgName })} href={`/s/${slug}`} cta={t('gone.shopProduct.cta', { org: orgName })} />;
  }
  if (!follow || !p) {
    return (
      <Empty icon={<IconBox size={40} />} title={t('catalog.followersTitle', { org: orgName })} body={t('catalog.followersBody')}
        action={joinHref ? <Link href={joinHref} className="btn btn-primary">{t('catalog.joinToBrowse', { org: orgName })}</Link> : undefined} />
    );
  }
  return <ProductView p={p} t={t} locale={locale} actions={<ProductActions p={p} joinHref={joinHref} />} />;
}
