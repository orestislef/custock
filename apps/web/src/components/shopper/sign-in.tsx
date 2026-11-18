'use client';

// sign in to a business's app with a code by email, no password. two steps on one card: the
// email, then the six digits. the code field fills itself from the message on phones that offer it.

import Link from 'next/link';
import { useState } from 'react';
import { IconMail } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

export function SignInCard({ title, lead }: { title?: string; lead?: string }) {
  const t = useT();
  const { requestCode, verifyCode, orgName, joinCode } = useShopper();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError(t('join.emailInvalid')); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await requestCode(email);
      setDevCode(r.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError(t(`common:error.${(err as { code?: string }).code ?? 'internal'}`));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
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
            <input className="field" type="email" inputMode="email" autoComplete="email" placeholder={t('shopper.signIn.email')} value={email}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} enterKeyHint="send" />
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
            <input className="field tnum" style={{ letterSpacing: '0.3em', fontSize: 22 }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*"
              placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus aria-invalid={!!error} enterKeyHint="go" />
          </label>
          {devCode ? <p className="t-foot t-2 m-0 mb-3">{t('shopper.signIn.devCode', { code: devCode })}</p> : null}
          {error ? <p className="t-sub m-0 mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
          <button className="btn btn-primary btn-large" type="submit" disabled={busy || code.length < 6}>{t('common:action.signIn')}</button>
          <button className="btn btn-plain w-full mt-2" type="button" onClick={() => { setStep('email'); setCode(''); setError(null); }}>{t('shopper.signIn.otherEmail')}</button>
        </form>
      )}
    </section>
  );
}
