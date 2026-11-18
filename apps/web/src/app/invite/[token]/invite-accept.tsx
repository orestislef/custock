'use client';

// joining a team from an invite link. someone new picks a name and a password and is in. someone
// with an account signs in and accepts. a used or old link says so and who to ask.

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { InvitePreview, Locale } from '@custock/core';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { IconShield, IconWarning } from '@/components/ui/icons';
import { createBrowserApi, loadTokens, saveTokens } from '@/lib/api-client';
import { useLocale, useT } from '@/lib/i18n-client';

type Mode = 'register' | 'signin';

export function InviteAccept({ token }: { token: string }) {
  const t = useT();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const api = useMemo(() => createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' }), []);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [failed, setFailed] = useState<'gone' | 'other' | null>(null);
  const [mode, setMode] = useState<Mode>('register');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.invitePreview(token).then(
      (p) => { setPreview(p); setMode(p.accountExists ? 'signin' : 'register'); },
      (e) => setFailed((e as { status?: number }).status === 410 || (e as { status?: number }).status === 404 ? 'gone' : 'other'),
    );
  }, [api, token]);

  const fail = (e: unknown) => {
    const code = (e as { code?: string }).code ?? 'internal';
    setError(code === 'unauthorized' ? t('login.wrong') : t(`common:error.${code}`));
    setBusy(false);
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) { setError(t('invite.passwordShort')); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.registerWithInvite({ token, displayName: name.trim(), password, locale });
      saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
      router.replace('/admin');
    } catch (err) {
      if ((err as { status?: number }).status === 409) { setMode('signin'); setError(t('invite.accountExists')); setBusy(false); return; }
      fail(err);
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (!loadTokens()) saveTokens(await api.login(preview.email, password));
      await api.acceptInvite(token);
      router.replace('/admin');
    } catch (err) {
      fail(err);
    }
  };

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-10" style={{ paddingTop: 'calc(40px + env(safe-area-inset-top))' }}>
      <div className="w-full max-w-[420px] page-in">
        <div className="flex justify-end mb-6"><LocaleSwitch /></div>
        {failed ? (
          <div className="text-center">
            <span className="inline-grid place-items-center w-16 h-16 rounded-full mb-4" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}><IconWarning size={30} /></span>
            <h1 className="t-title2 m-0">{failed === 'gone' ? t('invite.goneTitle') : t('admin.offlineTitle')}</h1>
            <p className="t-body t-2 mt-3 mb-0">{failed === 'gone' ? t('invite.goneBody') : t('admin.offlineBody')}</p>
          </div>
        ) : !preview ? (
          <div className="h-48 rounded-[16px] skel" aria-busy="true" />
        ) : (
          <>
            <span className="inline-grid place-items-center w-14 h-14 rounded-[14px] mb-4" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}><IconShield size={28} /></span>
            <h1 className="t-title1 t-display m-0">{t('invite.title', { org: preview.orgName })}</h1>
            <p className="t-body t-2 mt-2 mb-6">{t('invite.lead', { role: t(`common:role.${preview.roleName}`, { defaultValue: preview.roleName }), scope: preview.scopeName })}</p>

            {mode === 'register' ? (
              <form onSubmit={(e) => void register(e)} noValidate>
                <div className="list mb-2">
                  <label className="block">
                    <span className="field-label">{t('invite.email')}</span>
                    <input className="field pt-1" value={preview.email} readOnly aria-readonly="true" autoComplete="username" style={{ color: 'var(--c-ink-2)' }} />
                  </label>
                  <label className="block row-sep relative">
                    <span className="field-label">{t('invite.name')}</span>
                    <input className="field pt-1" autoComplete="name" required maxLength={80} placeholder={t('invite.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="block row-sep relative">
                    <span className="field-label">{t('invite.password')}</span>
                    <input className="field pt-1" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                </div>
                <p className="t-foot t-2 m-0 mb-4 px-4">{t('invite.passwordHint')}</p>
                {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                <button className="btn btn-primary btn-large" type="submit" disabled={busy || !name.trim() || !password}>{t('invite.join', { org: preview.orgName })}</button>
              </form>
            ) : (
              <form onSubmit={(e) => void signIn(e)} noValidate>
                <p className="t-sub t-2 m-0 mb-3">{t('invite.signInLead')}</p>
                <div className="list mb-3">
                  <label className="block">
                    <span className="sr-only">{t('login.email')}</span>
                    <input className="field" value={preview.email} readOnly aria-readonly="true" autoComplete="username" style={{ color: 'var(--c-ink-2)' }} />
                  </label>
                  {!loadTokens() ? (
                    <label className="block row-sep relative">
                      <span className="sr-only">{t('login.password')}</span>
                      <input className="field" type="password" autoComplete="current-password" placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </label>
                  ) : null}
                </div>
                {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                <button className="btn btn-primary btn-large" type="submit" disabled={busy || (!loadTokens() && !password)}>{t('invite.accept')}</button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
