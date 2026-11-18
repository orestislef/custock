'use client';

// "you" in a business's app: how this business may reach you, what you wait for and saved, the
// language, the home screen, your data, signing out. signed out it is the sign in card.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicProduct, StockAlertItem } from '@custock/core';
import { normalizeOtp } from '@custock/core';
import { AppIcon, InstallRow, InstallSteps } from '@/components/pwa/install-coach';
import { PushRow } from '@/components/pwa/push-row';
import { ProfilePhoto } from '@/components/ui/profile-photo';
import { NameRow } from '@/components/ui/name-row';
import { LocaleSwitch, PasswordField, Photo, Sheet, useToast } from '@/components/ui/client-kit';
import { AppearanceRow } from '@/components/ui/appearance-switch';
import { Empty, Switch } from '@/components/ui/kit';
import { IconBell, IconChevronRight, IconDownload, IconHeart, IconLogout, IconMail, IconPeople, IconPhoneApp, IconTrash } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { orgIconSrc } from './org-coach';
import { SignInCard } from './sign-in';
import { useShopper } from './shopper-context';

export function AccountView() {
  const t = useT();
  const toast = useToast();
  const { api, status, me, follow, slug, orgName, joinCode, signOut, reload, iconVersion, quietHours, pushDailyCap } = useShopper();
  const [alerts, setAlerts] = useState<StockAlertItem[] | null>(null);
  const [saved, setSaved] = useState<PublicProduct[] | null>(null);
  const [emailOn, setEmailOn] = useState(true);
  const [steps, setSteps] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // deleting asks for the password, or for a code sent by email when the account has none
  const [confirmWith, setConfirmWith] = useState<null | 'password' | 'code'>(null);
  const [secret, setSecret] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const icon = <AppIcon src={orgIconSrc(slug, iconVersion)} size={44} label={orgName} />;

  useEffect(() => {
    if (!follow) return;
    void api.alerts().then((a) => setAlerts(a.filter((x) => x.orgId === follow.orgId && x.status === 'waiting')), () => setAlerts([]));
    void api.favorites().then((f) => setSaved(f.filter((x) => x.orgId === follow.orgId)), () => setSaved([]));
  }, [api, follow]);

  if (status === 'loading') return <div className="h-40 rounded-[16px] skel" aria-busy="true" />;
  if (status === 'signedOut' || !me) {
    return (
      <>
        <SignInCard />
        <section className="inset-group mt-7">
          <div className="list"><div className="row"><span className="row-main row-title">{t('locale.label')}</span><LocaleSwitch /></div><AppearanceRow as="div" /></div>
        </section>
      </>
    );
  }

  const exportData = async () => {
    const data = await api.exportMyData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const file = new File([blob], `custock-${slug}-my-data.json`, { type: 'application/json' });
    // the share sheet on phones, a download elsewhere
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: t('shopper.me.export') }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    toast(t('shopper.me.exported'));
  };

  const closeDelete = () => {
    setDeleting(false);
    setConfirmWith(null);
    setSecret('');
    setDeleteError(null);
  };

  const askToConfirm = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      const r = await api.startAccountDelete();
      setConfirmWith(r.method);
      setSecret(r.method === 'code' && 'devCode' in r && r.devCode ? r.devCode : '');
    } catch (e) {
      setDeleteError(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!confirmWith) return void askToConfirm();
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteMyAccount(confirmWith === 'password' ? { password: secret } : { code: secret.trim() });
      await signOut();
      toast(t('shopper.me.deleted'));
      closeDelete();
    } catch (e) {
      const err = e as { code?: string; status?: number; problem?: { fields?: Record<string, string> } | null };
      if (err.status === 410) setDeleteError(t('shopper.me.deleteExpired'));
      else if (err.problem?.fields?.password || err.problem?.fields?.code) setDeleteError(t(confirmWith === 'password' ? 'shopper.me.deleteWrongPassword' : 'shopper.me.deleteWrongCode'));
      else setDeleteError(t(`common:error.${err.code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="inset-group">
        <div className="list">
          <div className="row" style={{ paddingTop: 12, paddingBottom: 12 }}>
            <ProfilePhoto api={api} name={me.user.displayName} avatarUrl={me.user.avatarUrl} size={52} onChanged={reload} className="w-full">
              <span className="row-title block truncate">{me.user.displayName}</span>
              <span className="row-sub block truncate">{me.user.email}</span>
            </ProfilePhoto>
          </div>
          <NameRow api={api} name={me.user.displayName} onSaved={reload} />
        </div>
      </section>

      {follow ? (
        <section className="inset-group">
          <h2 className="inset-group-head">{t('shopper.me.channels', { org: orgName })}</h2>
          <div className="list">
            <div className="row has-icon">
              <span className="icon-tile"><IconMail size={18} /></span>
              <span className="row-main"><span className="row-title block">{t('common:channel.email')}</span></span>
              <Switch checked={emailOn} label={t('common:channel.email')} onChange={(v) => { setEmailOn(v); void api.setChannel(follow.orgId, 'email', v).catch(() => setEmailOn(!v)); }} />
            </div>
            <PushRow api={api} orgId={follow.orgId} title={t('shopper.me.push')} sub={pushDailyCap > 0 ? t('shopper.me.pushSubCap', { count: pushDailyCap }) : t('shopper.me.pushSub')} onInstall={() => setSteps(true)} icon={<span className="icon-tile"><IconBell size={18} /></span>} />
          </div>
          <p className="inset-group-foot">{t('shopper.me.channelsFoot', { from: quietHours.split('-')[0], to: quietHours.split('-')[1] })}</p>
        </section>
      ) : (
        <Empty icon={<IconPeople size={40} />} title={t('shopper.news.notFollowingTitle', { org: orgName })} body={t('shopper.news.notFollowingBody')}
          action={joinCode ? <Link href={`/j/${joinCode}`} className="btn btn-primary">{t('catalog.joinToBrowse', { org: orgName })}</Link> : undefined} />
      )}

      {follow ? (
        <>
          <section className="inset-group">
            <h2 className="inset-group-head">{t('shopper.me.waiting')}</h2>
            <ul className="list" role="list">
              {alerts === null ? <li className="row"><span className="row-main t-2">…</span></li>
                : alerts.length ? alerts.map((a) => (
                  <li key={a.id} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                    <Photo src={a.imageUrl} alt={a.productName} size={44} />
                    <Link href={`/s/${slug}/p/${a.productId}?from=me`} className="row-main hover:no-underline" style={{ color: 'var(--c-ink)' }}>
                      <span className="row-title block truncate">{a.productName}</span>
                      {a.shopName ? <span className="row-sub block">{a.shopName}</span> : null}
                    </Link>
                    <button type="button" className="btn btn-plain" style={{ minHeight: 44, padding: '0 4px' }}
                      onClick={() => void api.cancelAlert(a.id).then(() => setAlerts((x) => (x ?? []).filter((y) => y.id !== a.id)))}>
                      {t('shopper.me.stopWaiting')}
                    </button>
                  </li>
                )) : <li className="row t-2"><span className="row-main">{t('shopper.me.waitingEmpty')}</span></li>}
            </ul>
            <p className="inset-group-foot">{t('shopper.me.waitingFoot')}</p>
          </section>

          <section className="inset-group">
            <h2 className="inset-group-head">{t('shopper.me.saved')}</h2>
            <ul className="list" role="list">
              {saved === null ? <li className="row"><span className="row-main t-2">…</span></li>
                : saved.length ? saved.map((p) => (
                  <li key={p.id}>
                    <Link href={`/s/${slug}/p/${p.id}?from=me`} className="row has-icon" style={{ '--sep-inset': '72px' } as React.CSSProperties}>
                      <Photo src={p.images[0]?.url} alt={p.name} size={44} />
                      <span className="row-main"><span className="row-title block truncate">{p.name}</span></span>
                      <IconChevronRight size={16} className="chev" />
                    </Link>
                  </li>
                )) : <li className="row t-2"><span className="row-main flex items-center gap-2"><IconHeart size={16} />{t('shopper.me.savedEmpty')}</span></li>}
            </ul>
          </section>
        </>
      ) : null}

      <section className="inset-group">
        <ul className="list" role="list">
          <li className="row"><span className="row-main row-title">{t('locale.label')}</span><LocaleSwitch /></li>
          <AppearanceRow />
          <InstallRow appName={orgName} icon={icon} render={(open, label) => (
            <li>
              <button type="button" className="row has-icon" onClick={open}>
                <span className="icon-tile"><IconPhoneApp size={18} /></span>
                <span className="row-main row-title">{label}</span>
                <IconChevronRight size={16} className="chev" />
              </button>
            </li>
          )} />
        </ul>
      </section>

      <section className="inset-group">
        <h2 className="inset-group-head">{t('shopper.me.privacy')}</h2>
        <ul className="list" role="list">
          <li>
            <button type="button" className="row has-icon" onClick={() => void exportData()}>
              <span className="icon-tile"><IconDownload size={18} /></span>
              <span className="row-main row-title">{t('shopper.me.export')}</span>
            </button>
          </li>
          <li>
            <button type="button" className="row has-icon" onClick={() => setDeleting(true)} style={{ color: 'var(--c-error)' }}>
              <span className="icon-tile neg"><IconTrash size={18} /></span>
              <span className="row-main row-title">{t('shopper.me.delete')}</span>
            </button>
          </li>
        </ul>
        <p className="inset-group-foot">{t('shopper.me.privacyFoot')}</p>
      </section>

      <section className="inset-group">
        <ul className="list" role="list">
          <li>
            <button type="button" className="row" onClick={() => void signOut()} style={{ color: 'var(--c-error)' }}>
              <IconLogout size={20} />
              <span className="row-main row-title">{t('common:action.signOut')}</span>
            </button>
          </li>
        </ul>
      </section>

      <InstallSteps open={steps} onClose={() => setSteps(false)} appName={orgName} icon={icon} />
      <Sheet open={deleting} onClose={closeDelete} title={t('shopper.me.deleteTitle')} error={deleteError}
        footer={
          <div className="flex flex-col gap-2 pb-2">
            <button type="button" className="btn btn-large" style={{ background: 'var(--c-error)', color: '#fff' }} disabled={busy || (!!confirmWith && !secret.trim())} onClick={() => void deleteAccount()}>
              {confirmWith ? t('shopper.me.deleteConfirm') : t('shopper.me.deleteContinue')}
            </button>
            <button type="button" className="btn btn-gray btn-large" onClick={closeDelete}>{t('common:action.cancel')}</button>
          </div>
        }>
        <p className="t-body m-0 mb-3">{t('shopper.me.deleteBody')}</p>
        {confirmWith === 'code' ? (
          <form onSubmit={(e) => { e.preventDefault(); void deleteAccount(); }}>
            <p className="t-sub t-2 m-0 mb-2">{t('shopper.me.deleteCodeSent', { email: me?.user.email ?? '' })}</p>
            <label className="block">
              <span className="t-foot t-2 block mb-1">{t('shopper.me.deleteCodeLabel')}</span>
              <input className="field tnum" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={16} value={secret} onChange={(e) => setSecret(normalizeOtp(e.target.value))} data-autofocus />
            </label>
            <button type="button" className="btn btn-plain mt-2" disabled={busy} onClick={() => void askToConfirm()}>{t('shopper.me.deleteResend')}</button>
          </form>
        ) : confirmWith === 'password' ? (
          <form onSubmit={(e) => { e.preventDefault(); void deleteAccount(); }}>
            <label className="block">
              <span className="t-foot t-2 block mb-1">{t('shopper.me.deletePasswordLabel')}</span>
              <PasswordField autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />
            </label>
          </form>
        ) : null}
      </Sheet>
    </>
  );
}
