'use client';

// becoming a super admin from an invite link. someone new picks a name and a password. someone
// with an account signs in with the invited email and accepts. a used or old link says so.

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Locale, PlatformInvitePreview } from '@custock/core';
import { LocaleSwitch, PasswordField } from '@/components/ui/client-kit';
import { IconShield, IconWarning } from '@/components/ui/icons';
import { createBrowserApi, loadTokens, saveTokens } from '@/lib/api-client';
import { useLocale, useT } from '@/lib/i18n-client';
import { checkText, cleanLine, LIMITS, passwordProblem, type FieldError } from '@custock/core';
import { FieldMessage } from '@/components/ui/field-kit';

type Mode = 'register' | 'signin';

export function PlatformInviteAccept({ token }: { token: string }) {
  const t = useT();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const api = useMemo(() => createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' }), []);
  const [preview, setPreview] = useState<PlatformInvitePreview | null>(null);
  const [failed, setFailed] = useState<'gone' | 'other' | null>(null);
  const [mode, setMode] = useState<Mode>('register');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<FieldError | null>(null);
  const [passwordError, setPasswordError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.platformInvitePreview(token).then(
      (p) => { setPreview(p); setMode(p.accountExists ? 'signin' : 'register'); },
      (e) => setFailed((e as { status?: number }).status === 410 || (e as { status?: number }).status === 404 ? 'gone' : 'other'),
    );
  }, [api, token]);

  const fail = (e: unknown) => {
    const code = (e as { code?: string }).code ?? 'internal';
    setError(code === 'unauthorized' ? t('login.wrong') : t(`common:error.${code}`));
    setBusy(false);
  };

  const done = () => {
    localStorage.removeItem('custock.org');
    router.replace('/admin/platform');
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    // the shared rules: a name of one line, a password of 10 to 128 with no spaces that is not the email
    const nameV = cleanLine(name);
    const nameP = checkText(nameV, { max: LIMITS.personName, required: true });
    const pwP = passwordProblem(password, preview?.email);
    setName(nameV);
    setNameError(nameP);
    setPasswordError(pwP);
    if (nameP || pwP) { document.getElementById(nameP ? 'invite-name' : 'invite-password')?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.registerPlatformInvite({ token, displayName: nameV, password, locale });
      saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt });
      done();
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
      await api.acceptPlatformInvite(token);
      done();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col px-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full max-w-[420px] mx-auto flex justify-end pt-3"><LocaleSwitch /></div>
      <div className="flex-1 grid place-items-center py-8">
        <div className="w-full max-w-[420px] page-in">
          {failed ? (
            <div className="text-center">
              <span className="inline-grid place-items-center w-16 h-16 rounded-full mb-4" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}><IconWarning size={30} /></span>
              <h1 className="t-title2 m-0">{failed === 'gone' ? t('invite.goneTitle') : t('admin.offlineTitle')}</h1>
              <p className="t-body t-2 mt-3 mb-0">{failed === 'gone' ? t('platformInvite.goneBody') : t('admin.offlineBody')}</p>
            </div>
          ) : !preview ? (
            <div className="h-48 rounded-[16px] skel" aria-busy="true" />
          ) : (
            <>
              <span className="inline-grid place-items-center w-14 h-14 rounded-[14px] mb-4" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}><IconShield size={28} /></span>
              <h1 className="t-title1 t-display m-0">{t('platformInvite.title')}</h1>
              <p className="t-body t-2 mt-2 mb-6">{preview.invitedBy ? t('platformInvite.leadBy', { name: preview.invitedBy }) : t('platformInvite.lead')}</p>

              {mode === 'register' ? (
                <form onSubmit={(e) => void register(e)} noValidate>
                  <div className="list mb-2">
                    <label className="block">
                      <span className="field-label">{t('invite.email')}</span>
                      <input className="field pt-1" value={preview.email} readOnly aria-readonly="true" autoComplete="username" style={{ color: 'var(--c-ink-2)' }} />
                    </label>
                    <label className="block row-sep relative">
                      <span className="field-label">{t('invite.name')}</span>
                      <input id="invite-name" className="field pt-1" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required maxLength={LIMITS.personName + 20} placeholder={t('invite.namePlaceholder')} value={name}
                      aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? 'invite-name-error' : undefined}
                      onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
                      onBlur={() => setName((v) => cleanLine(v))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); document.getElementById('invite-password')?.focus(); } }} />
                    <FieldMessage id="invite-name-error" kind="line" error={nameError} params={{ max: LIMITS.personName }} />
                    </label>
                    <label className="block row-sep relative">
                      <span className="field-label">{t('invite.password')}</span>
                      <PasswordField id="invite-password" className="field pt-1" autoComplete="new-password" enterKeyHint="go" required minLength={10} maxLength={128} value={password}
                      aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? 'invite-password-error' : undefined}
                      onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError(null); }}
                      onBlur={() => { if (password) setPasswordError(passwordProblem(password, preview?.email)); }} />
                    <FieldMessage id="invite-password-error" kind="password" error={passwordError} />
                    </label>
                  </div>
                  <p className="t-foot t-2 m-0 mb-4 px-4">{t('invite.passwordHint')}</p>
                  {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                  <button className="btn btn-primary btn-large" type="submit" disabled={busy || !name.trim() || !password}>{t('platformInvite.accept')}</button>
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
                        <PasswordField autoComplete="current-password" enterKeyHint="go" maxLength={200} placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
                      </label>
                    ) : null}
                  </div>
                  {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                  <button className="btn btn-primary btn-large" type="submit" disabled={busy || (!loadTokens() && !password)}>{t('platformInvite.accept')}</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
