'use client';

// the other super admins: who they are, invites waiting, inviting one more and removing one.
// both ask first, because a super admin has full access to every business. the last one stays.

import { useEffect, useState } from 'react';
import type { Locale } from '@custock/core';
import { usePlatform } from '@/components/admin/admin-context';
import { Avatar, Group, Row } from '@/components/ui/kit';
import { Picker, Sheet, useToast } from '@/components/ui/client-kit';
import { IconMail, IconPlus } from '@/components/ui/icons';
import { useAsync } from '@/lib/use-async';
import { relative } from '@/lib/format';
import { LinkActions } from './bits';

type Step = 'form' | 'confirm' | 'done';

export function SuperAdminsSection() {
  const { api, t, locale } = usePlatform();
  const toast = useToast();
  const list = useAsync(() => api.superAdmins(), []);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [link, setLink] = useState<{ link: string; emailed: boolean; email: string } | null>(null);

  const remove = async () => {
    const r = removing!;
    setRemoving(null);
    try {
      await api.removeSuperAdmin(r.userId);
      toast(t('platform.admins.removed', { name: r.name }));
      void list.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  };

  const resend = async (id: string, email: string) => {
    try {
      const r = await api.resendSuperAdminInvite(id);
      setLink({ link: r.link, emailed: r.emailed, email });
      void list.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeSuperAdminInvite(id);
      toast(t('platform.invite.revoked'));
      void list.reload();
    } catch (e) {
      toast(t(`common:error.${(e as { code?: string }).code ?? 'internal'}`));
    }
  };

  const admins = list.data?.admins ?? [];
  return (
    <section aria-labelledby="admins-h">
      <div className="flex items-end gap-3 mb-1">
        <h2 id="admins-h" className="t-title3 m-0 flex-1">{t('platform.admins.title')}</h2>
        <button type="button" className="btn btn-tinted" onClick={() => setInviting(true)}><IconPlus size={18} />{t('platform.admins.invite')}</button>
      </div>
      <p className="t-sub t-2 m-0 mb-3">{t('platform.admins.lead')}</p>
      {!list.data ? <div className="h-32 rounded-[16px] skel" aria-busy="true" /> : (
        <Group footer={admins.length <= 1 ? t('platform.admins.lastFoot') : undefined}>
          {admins.map((a) => (
            <Row key={a.userId} chevron={false} leading={<Avatar name={a.name ?? a.email} size={32} />}
              title={<span className="inline-flex items-center gap-2">{a.name ?? a.email}{a.you ? <span className="badge badge-gray">{t('platform.admins.you')}</span> : null}</span>}
              subtitle={a.email ?? undefined}
              trailing={!a.you && admins.length > 1 ? (
                <button type="button" className="btn btn-plain" style={{ color: 'var(--c-error)' }} onClick={() => setRemoving({ userId: a.userId, name: a.name ?? a.email ?? '' })}>{t('platform.admins.remove')}</button>
              ) : undefined} />
          ))}
          {list.data.invites.map((i) => (
            <Row key={i.id} chevron={false} leading={<span className="icon-tile"><IconMail size={18} /></span>}
              title={i.email}
              subtitle={i.expired ? t('platform.invite.expired') : t('platform.invite.sent', { when: relative(i.createdAt, locale) })}
              trailing={
                <span className="flex gap-1">
                  <button type="button" className="btn btn-plain" onClick={() => void resend(i.id, i.email)}>{t('platform.invite.resend')}</button>
                  <button type="button" className="btn btn-plain" style={{ color: 'var(--c-error)' }} onClick={() => void revoke(i.id)}>{t('platform.invite.revoke')}</button>
                </span>
              } />
          ))}
        </Group>
      )}

      <InviteSuperAdminSheet open={inviting} onClose={() => setInviting(false)} onDone={() => void list.reload()} />

      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={t('platform.admins.removeTitle')}
        footer={<>
          <button type="button" className="btn btn-gray" onClick={() => setRemoving(null)}>{t('common:action.cancel')}</button>
          <button type="button" className="btn btn-danger-fill" onClick={() => void remove()}>{t('platform.admins.remove')}</button>
        </>}>
        <p className="t-body m-0">{removing ? t('platform.admins.removeBody', { name: removing.name }) : ''}</p>
      </Sheet>

      <Sheet open={!!link} onClose={() => setLink(null)} title={t('platform.invite.newLink')}
        footer={<button type="button" className="btn btn-primary" onClick={() => setLink(null)}>{t('common:action.done')}</button>}>
        {link ? (
          <div className="flex flex-col gap-4">
            <p className="t-body m-0">{link.emailed ? t('platform.invite.emailed', { email: link.email }) : t('platform.invite.shareIt', { email: link.email })}</p>
            <p className="t-foot t-2 m-0 break-all">{link.link}</p>
            <LinkActions link={link.link} t={t} title={t('platform.admins.shareTitle')} />
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

function InviteSuperAdminSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { api, t, locale } = usePlatform();
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [lang, setLang] = useState<Locale>((['en', 'el', 'ru'].includes(locale) ? locale : 'en') as Locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ link: string; emailed: boolean } | null>(null);

  useEffect(() => {
    if (!open) { setStep('form'); setEmail(''); setError(null); setDone(null); setBusy(false); }
  }, [open]);

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.inviteSuperAdmin({ email: email.trim(), locale: lang });
      setDone(r);
      setStep('done');
      onDone();
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'internal';
      setError(code === 'conflict' ? t('platform.admins.already') : t(`common:error.${code}`));
      setStep('form');
    } finally {
      setBusy(false);
    }
  };

  const footer = step === 'form' ? (
    <>
      <button type="button" className="btn btn-gray" onClick={onClose}>{t('common:action.cancel')}</button>
      <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => setStep('confirm')}>{t('common:action.next')}</button>
    </>
  ) : step === 'confirm' ? (
    <>
      <button type="button" className="btn btn-gray" onClick={() => setStep('form')}>{t('common:action.back')}</button>
      <button type="button" className="btn btn-danger-fill" disabled={busy} onClick={() => void invite()}>{t('platform.admins.inviteConfirm')}</button>
    </>
  ) : (
    <button type="button" className="btn btn-primary" onClick={onClose}>{t('common:action.done')}</button>
  );

  return (
    <Sheet open={open} onClose={onClose} title={t('platform.admins.invite')} error={error} footer={footer}>
      {step === 'form' ? (
        <>
          <div className="list mb-2">
            <label className="block">
              <span className="field-label">{t('platform.admins.email')}</span>
              <input className="field pt-1" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="row row-sep">
              <span className="row-main row-title">{t('platform.new.language')}</span>
              <Picker label={t('platform.new.language')} value={lang} onChange={(v) => setLang(v as Locale)}
                options={[{ value: 'en', label: 'English' }, { value: 'el', label: 'Ελληνικά' }, { value: 'ru', label: 'Русский' }]} />
            </div>
          </div>
          <p className="t-foot t-2 m-0 px-4">{t('platform.admins.formFoot')}</p>
        </>
      ) : step === 'confirm' ? (
        <div className="flex flex-col gap-3">
          <p className="t-headline m-0">{t('platform.admins.confirmTitle', { email: email.trim() })}</p>
          <p className="t-body m-0">{t('platform.admins.confirmBody')}</p>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <p className="t-body m-0">{done.emailed ? t('platform.invite.emailed', { email: email.trim() }) : t('platform.invite.shareIt', { email: email.trim() })}</p>
          <p className="t-foot t-2 m-0 break-all">{done.link}</p>
          <LinkActions link={done.link} t={t} title={t('platform.admins.shareTitle')} />
        </div>
      ) : null}
    </Sheet>
  );
}
