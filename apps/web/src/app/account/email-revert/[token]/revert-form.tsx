'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { emailRevertAction, type EmailRevertState } from '@/app/actions';
import { useT } from '@/lib/i18n-client';
import { IconCheck, IconWarning } from '@/components/ui/icons';

export function EmailRevertForm({ token }: { token: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<EmailRevertState>(emailRevertAction.bind(null, token), { status: 'idle' });

  if (state.status === 'done') {
    return (
      <div className="card p-6 text-center page-in">
        <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'color-mix(in srgb, var(--c-success) 14%, transparent)', color: 'var(--c-success)' }}>
          <IconCheck size={28} />
        </span>
        <h2 className="t-title3 m-0">{t('emailRevert.doneTitle')}</h2>
        <p className="t-body t-2 mt-2 mb-0">{t('emailRevert.doneBody', { email: state.email ?? '' })}</p>
        <Link href="/admin/login" className="btn btn-primary btn-large mt-5">{t('emailRevert.signIn')}</Link>
        <p className="t-foot t-2 mt-3 mb-0"><Link href="/admin/forgot">{t('emailRevert.forgot')}</Link></p>
      </div>
    );
  }

  if (state.status === 'error' && (state.error === 'invite_expired' || state.error === 'conflict' || state.error === 'not_found')) {
    return (
      <div className="card p-6 text-center page-in">
        <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'var(--c-out-tint)', color: 'var(--c-out-text)' }}>
          <IconWarning size={26} />
        </span>
        <h2 className="t-title3 m-0">{t('emailRevert.failTitle')}</h2>
        <p className="t-body t-2 mt-2 mb-0">{t('emailRevert.failBody')}</p>
      </div>
    );
  }

  return (
    <form action={action}>
      {state.status === 'error' ? <p className="t-sub mb-4" role="alert" style={{ color: 'var(--c-error)' }}>{t(`common:error.${state.error ?? 'internal'}`)}</p> : null}
      <button type="submit" className="btn btn-primary btn-large" disabled={pending}>{t('emailRevert.button')}</button>
    </form>
  );
}
