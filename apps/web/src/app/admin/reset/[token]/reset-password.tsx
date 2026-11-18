'use client';

// a new password from the forgot password link. the link is checked first, so a used or old one
// gets a calm page with a way to ask for a new one instead of a form that cannot work.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LocaleSwitch, PasswordField } from '@/components/ui/client-kit';
import { IconLock, IconWarning } from '@/components/ui/icons';
import { createBrowserApi, saveTokens } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';

const MIN_LENGTH = 10;

type Strength = 'short' | 'weak' | 'good' | 'strong';

// length counts most, a mix of kinds of characters helps. a hint, not a rule: the only rule is 10+
export function strengthOf(pw: string): Strength {
  if (pw.length < MIN_LENGTH) return 'short';
  const kinds = [/[a-zα-ωа-я]/, /[A-ZΑ-ΩА-Я]/, /\d/, /[^\p{L}\d]/u].filter((r) => r.test(pw)).length;
  const repeats = /(.)\1{3,}/.test(pw);
  if (pw.length >= 16 && kinds >= 2 && !repeats) return 'strong';
  if (pw.length >= 12 && kinds >= 3 && !repeats) return 'strong';
  if (repeats || (pw.length < 12 && kinds < 2)) return 'weak';
  return 'good';
}

const LEVEL: Record<Strength, number> = { short: 0, weak: 1, good: 2, strong: 3 };
const COLOR: Record<Strength, string> = { short: 'var(--c-ink-3)', weak: 'var(--c-few-text)', good: 'var(--c-accent)', strong: 'var(--c-success)' };

export function ResetPassword({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const api = useMemo(() => createBrowserApi({ getLocale: () => document.documentElement.lang || 'en' }), []);
  const [state, setState] = useState<'checking' | 'ready' | 'gone'>('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.passwordResetPreview(token).then(
      () => setState('ready'),
      (e) => {
        const status = (e as { status?: number }).status;
        if (status === 410 || status === 404 || status === 400) setState('gone');
        else { setState('ready'); }
      },
    );
  }, [api, token]);

  const strength = strengthOf(password);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await api.resetPassword(token, password);
      saveTokens(tokens);
      router.replace('/admin');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 410) { setState('gone'); setBusy(false); return; }
      const code = (err as { code?: string }).code;
      setError(code === 'rate_limited' ? t('common:error.rate_limited') : t('reset.failed'));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col px-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full max-w-[400px] mx-auto flex justify-end pt-3"><LocaleSwitch /></div>
      <div className="flex-1 grid place-items-center py-8">
        <div className="w-full max-w-[400px] page-in">
          {state === 'checking' ? (
            <p className="t-body t-2 text-center" role="status">{t('reset.checking')}</p>
          ) : state === 'gone' ? (
            <div className="text-center">
              <div className="icon-tile mx-auto mb-5" style={{ width: 56, height: 56, borderRadius: 16 }} aria-hidden="true"><IconWarning size={28} /></div>
              <h1 className="t-title2 t-display m-0">{t('reset.goneTitle')}</h1>
              <p className="t-body t-2 mt-3 mb-8">{t('reset.goneLead')}</p>
              <Link href="/admin/forgot" className="btn btn-primary btn-large">{t('reset.newLink')}</Link>
              <p className="mt-4 mb-0"><Link href="/admin/login" className="t-body inline-flex items-center min-h-[44px]">{t('forgot.back')}</Link></p>
            </div>
          ) : (
            <>
              <div className="icon-tile mb-5" style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }} aria-hidden="true"><IconLock size={28} /></div>
              <h1 className="t-large t-display m-0">{t('reset.title')}</h1>
              <p className="t-body t-2 mt-2 mb-8">{t('reset.lead')}</p>
              <form onSubmit={(e) => void save(e)} noValidate>
                <div className="list mb-3">
                  <label className="block relative">
                    <span className="sr-only">{t('reset.password')}</span>
                    <PasswordField autoComplete="new-password" placeholder={t('reset.password')} value={password}
                      onChange={(e) => setPassword(e.target.value)} minLength={MIN_LENGTH} maxLength={200} required autoFocus aria-describedby="pw-strength" />
                  </label>
                </div>
                <div id="pw-strength" className="mb-6" aria-live="polite">
                  <div className="flex gap-1.5 mb-2" role="meter" aria-label={t('reset.strength.label')} aria-valuemin={0} aria-valuemax={3} aria-valuenow={LEVEL[strength]}>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className="flex-1 h-1 rounded-full" style={{ background: LEVEL[strength] >= i ? COLOR[strength] : 'var(--c-fill)', transition: 'background-color 200ms ease-out' }} />
                    ))}
                  </div>
                  <p className="t-foot m-0" style={{ color: password ? COLOR[strength] : 'var(--c-ink-2)' }}>{t(`reset.strength.${strength}`)}</p>
                </div>
                {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
                <button className="btn btn-primary btn-large" type="submit" disabled={busy || password.length < MIN_LENGTH}>{t('reset.save')}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
