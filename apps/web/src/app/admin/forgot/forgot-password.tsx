'use client';

// forgot password. the answer is always the same, so this page never says whether the email has
// an account. sending again waits a little, the server limits it anyway.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '@custock/core';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { IconMail } from '@/components/ui/icons';
import { createBrowserApi } from '@/lib/api-client';
import { useLocale, useT } from '@/lib/i18n-client';
import { emailProblem, normalizeEmail, type FieldError } from '@custock/core';
import { FieldMessage } from '@/components/ui/field-kit';
import { SessionGate } from '@/components/session-gate';

const WAIT_S = 60;

export function ForgotPassword({ initialEmail }: { initialEmail: string }) {
  const t = useT();
  const locale = useLocale() as Locale;
  const api = useMemo(() => createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' }), []);
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<FieldError | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const address = normalizeEmail(email);
    if (!address || busy) return;
    const problem = emailProblem(address);
    if (problem) { setEmailError(problem); return; }
    setEmail(address);
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(address, locale);
      setSentTo(address);
      setWait(WAIT_S);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'validation' ? t('common:error.validation') : code === 'rate_limited' ? t('common:error.rate_limited') : t('forgot.failed'));
    } finally {
      setBusy(false);
    }
  }

  const time = `0:${String(wait).padStart(2, '0')}`;

  return (
    <main data-guest className="min-h-dvh flex flex-col px-safe-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <SessionGate />
      <div className="w-full max-w-[400px] mx-auto flex justify-end pt-3"><LocaleSwitch /></div>
      <div className="flex-1 grid place-items-center py-8">
        <div className="w-full max-w-[400px] page-in">
          {sentTo ? (
            <>
              <div className="icon-tile mb-5" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }} aria-hidden="true"><IconMail size={28} /></div>
              <h1 className="t-large t-display m-0">{t('forgot.sentTitle')}</h1>
              <p className="t-body mt-3 mb-2" aria-live="polite">{t('forgot.sentLead', { email: sentTo })}</p>
              <p className="t-sub t-2 mb-8">{t('forgot.sentHint')}</p>
              <button type="button" className="btn btn-gray btn-large" onClick={() => void send()} disabled={busy || wait > 0}>
                {wait > 0 ? t('forgot.againWait', { time }) : t('forgot.again')}
              </button>
              {error ? <p className="t-sub mt-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
            </>
          ) : (
            <>
              <h1 className="t-large t-display m-0">{t('forgot.title')}</h1>
              <p className="t-body t-2 mt-2 mb-8">{t('forgot.lead')}</p>
              <form onSubmit={(e) => void send(e)} noValidate>
                <div className="list mb-3">
                  <label className="block">
                    <span className="sr-only">{t('forgot.email')}</span>
                    <input className="field" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" maxLength={254}
                      placeholder={t('forgot.email')} value={email} aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? 'forgot-email-error' : undefined}
                      onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(null); }}
                      onBlur={() => { setEmail((v) => normalizeEmail(v)); if (email.trim()) setEmailError(emailProblem(email)); }}
                      required autoFocus={!initialEmail} />
                  </label>
                  <FieldMessage id="forgot-email-error" kind="email" error={emailError} />
                </div>
                {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                <button className="btn btn-primary btn-large" type="submit" disabled={busy || !email.trim()}>{t('forgot.send')}</button>
              </form>
            </>
          )}
          <p className="text-center mt-6 mb-0">
            <Link href="/admin/login" className="t-body inline-flex items-center min-h-[44px]">{t('forgot.back')}</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
