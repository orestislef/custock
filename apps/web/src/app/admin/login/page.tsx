'use client';

import { useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoginApi } from '@/components/admin/admin-context';
import { saveTokens } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';
import { FIXTURE_LOGINS } from '@/lib/fixtures';
import { LocaleSwitch } from '@/components/ui/client-kit';
import { Avatar } from '@/components/ui/kit';

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const ctx = useContext(LoginApi);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <main className="min-h-dvh grid place-items-center px-4 py-10" style={{ paddingTop: 'calc(40px + env(safe-area-inset-top))' }}>
      <div className="w-full max-w-[400px] page-in">
        <div className="flex justify-end mb-6"><LocaleSwitch compact /></div>
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
              <input className="field" type="password" autoComplete="current-password" placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </div>
          {error ? <p className="t-sub mb-3" role="alert" style={{ color: 'var(--c-error)' }}>{error}</p> : null}
          <button className="btn btn-primary btn-large" type="submit" disabled={busy || !email || !password}>{t('common:action.signIn')}</button>
        </form>

        <section className="group mt-10">
          <h2 className="group-head">{t('login.devTitle')}</h2>
          <div className="list">
            {FIXTURE_LOGINS.map((u) => (
              <button key={u.email} type="button" className="row" onClick={() => void signIn(undefined, u.email)} disabled={busy}>
                <Avatar name={u.name} size={32} />
                <span className="row-main">
                  <span className="row-title block">{u.name}</span>
                  <span className="row-sub block">{t(`common:role.${u.role}`)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="group-foot">{t('login.devFoot')}</p>
        </section>
      </div>
    </main>
  );
}
