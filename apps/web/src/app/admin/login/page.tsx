'use client';

import Link from 'next/link';
import { useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoginApi } from '@/components/admin/admin-context';
import { saveTokens } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';
import { devBuild } from '@/lib/env';
import { LocaleSwitch, PasswordField } from '@/components/ui/client-kit';
import { Avatar } from '@/components/ui/kit';

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const ctx = useContext(LoginApi);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // quick logins for the made up accounts, only while developing
  const [devLogins, setDevLogins] = useState<{ email: string; name: string; role: string }[]>([]);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && devBuild) void import('@/lib/fixtures').then((m) => setDevLogins(m.FIXTURE_LOGINS));
  }, []);

  async function signIn(e?: React.FormEvent, as?: string) {
    e?.preventDefault();
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await ctx.api.login(as ?? email, as ? 'custock' : password);
      saveTokens(tokens);
      ctx.onSignedIn();
      router.replace('/admin');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'unauthorized' ? t('login.wrong') : t(`common:error.${code ?? 'internal'}`));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col px-4" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full max-w-[400px] mx-auto flex justify-end pt-3"><LocaleSwitch /></div>
      <div className="flex-1 grid place-items-center py-8">
      <div className="w-full max-w-[400px] page-in">
        <h1 className="t-large t-display m-0">Custock</h1>
        <p className="t-body t-2 mt-2 mb-8">{t('login.lead')}</p>
        <form onSubmit={(e) => void signIn(e)} noValidate>
          <div className="list mb-3">
            <label className="block">
              <span className="sr-only">{t('login.email')}</span>
              <input className="field" type="email" autoComplete="username" inputMode="email" placeholder={t('login.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block row-sep relative">
              <span className="sr-only">{t('login.password')}</span>
              <PasswordField autoComplete="current-password" placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </div>
          {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
          <button className="btn btn-primary btn-large" type="submit" disabled={busy || !email || !password}>{t('common:action.signIn')}</button>
        </form>
        <p className="text-center mt-4 mb-0">
          <Link href={email.trim() ? `/admin/forgot?email=${encodeURIComponent(email.trim())}` : '/admin/forgot'} className="t-body inline-flex items-center min-h-[44px]">{t('login.forgot')}</Link>
        </p>

        {devLogins.length ? <section className="inset-group mt-10">
          <h2 className="inset-group-head">{t('login.devTitle')}</h2>
          <div className="list">
            {devLogins.map((u) => (
              <button key={u.email} type="button" className="row" onClick={() => void signIn(undefined, u.email)} disabled={busy}>
                <Avatar name={u.name} size={32} />
                <span className="row-main">
                  <span className="row-title block">{u.name}</span>
                  <span className="row-sub block">{t(`common:role.${u.role}`)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="inset-group-foot">{t('login.devFoot')}</p>
        </section> : null}
      </div>
      </div>
    </main>
  );
}
