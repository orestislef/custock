'use client';

// sign in to a business's app with a code by email, no password. two steps on one card: the
// email, then the six digits. the code field fills itself from the message on phones that offer it.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconMail } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';
import { emailProblem, normalizeEmail, normalizeOtp } from '@custock/core';
import { fieldMessage } from '@/lib/fields';

export function SignInCard({ title, lead }: { title?: string; lead?: string }) {
  const t = useT();
  const { requestCode, verifyCode, orgName, joinCode } = useShopper();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a new code can be asked for again after a short wait, the server limits it as well
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    if (step !== 'code' || !waitUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, waitUntil]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = normalizeEmail(email);
    const problem = emailProblem(address);
    if (problem) { setError(fieldMessage(t as unknown as (k: string, o: Record<string, unknown>) => string, 'email', problem)); return; }
    setEmail(address);
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(address);
      setDevCode(r.devCode ?? null);
      setStep('code');
      setWaitUntil(Date.now() + 30_000);
      setNow(Date.now());
    } catch (err) {
      setError(t(`common:error.${(err as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(normalizeEmail(email));
      setDevCode(r.devCode ?? null);
      setCode('');
      setResent(true);
      setWaitUntil(Date.now() + 30_000);
      setNow(Date.now());
    } catch (err) {
      setError(t(`common:error.${(err as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };
  const secondsLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(normalizeEmail(email), normalizeOtp(code));
    } catch (err) {
      const c = (err as { code?: string }).code;
      setError(c === 'unauthorized' || c === 'validation' ? t('shopper.signIn.wrongCode') : t(`common:error.${c ?? 'internal'}`));
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 page-in">
      <span className="inline-grid place-items-center w-12 h-12 rounded-full mb-3" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}>
        <IconMail size={24} />
      </span>
      <h2 className="t-title3 m-0">{title ?? t('shopper.signIn.title')}</h2>
      {step === 'email' ? (
        <form onSubmit={(e) => void send(e)} noValidate>
          <p className="t-sub t-2 mt-1 mb-4">{lead ?? t('shopper.signIn.lead', { org: orgName })}</p>
          <label className="block list mb-3">
            <span className="sr-only">{t('shopper.signIn.email')}</span>
            <input className="field" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254} placeholder={t('shopper.signIn.email')} value={email}
              onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmail((v) => normalizeEmail(v))} aria-invalid={!!error} enterKeyHint="send" />
          </label>
          {error ? <p className="t-sub m-0 mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
          <button className="btn btn-primary btn-large" type="submit" disabled={busy || !email.trim()}>{t('shopper.signIn.send')}</button>
          {joinCode ? <p className="t-foot t-2 m-0 mt-4 text-center">{t('shopper.signIn.notYet')} <Link href={`/j/${joinCode}`}>{t('shopper.signIn.joinLink', { org: orgName })}</Link></p> : null}
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)} noValidate>
          <p className="t-sub t-2 mt-1 mb-4">{t('shopper.signIn.sentTo', { email: email.trim() })}</p>
          <label className="block list mb-3">
            <span className="sr-only">{t('shopper.signIn.code')}</span>
            <input className="field tnum" style={{ letterSpacing: '0.3em', fontSize: 22 }} inputMode="numeric" autoComplete="one-time-code" maxLength={16} pattern="[0-9 -]*"
              placeholder="000000" value={code} onChange={(e) => setCode(normalizeOtp(e.target.value))} autoCorrect="off" spellCheck={false} autoFocus aria-invalid={!!error} enterKeyHint="go" />
          </label>
          {devCode ? <p className="t-foot t-2 m-0 mb-3">{t('shopper.signIn.devCode', { code: devCode })}</p> : null}
          {error ? <p className="t-sub m-0 mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
          <button className="btn btn-primary btn-large" type="submit" disabled={busy || code.length < 6}>{t('common:action.signIn')}</button>
          {resent ? <p className="t-foot t-2 m-0 mt-3 text-center" role="status">{t('shopper.signIn.resent')}</p> : null}
          <button className="btn btn-plain w-full mt-2" type="button" disabled={busy || secondsLeft > 0} onClick={() => void resend()}>
            {secondsLeft > 0 ? t('shopper.signIn.resendIn', { count: secondsLeft }) : t('shopper.signIn.resend')}
          </button>
          <button className="btn btn-plain w-full" type="button" onClick={() => { setStep('email'); setCode(''); setError(null); setResent(false); }}>{t('shopper.signIn.otherEmail')}</button>
        </form>
      )}
    </section>
  );
}
