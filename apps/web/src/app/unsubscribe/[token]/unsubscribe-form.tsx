'use client';

import { useActionState, useState } from 'react';
import { unsubscribeAction, type UnsubscribeState } from '@/app/actions';
import { useT } from '@/lib/i18n-client';
import { IconCheck } from '@/components/ui/icons';

export function UnsubscribeForm({ token, shop, org }: { token: string; shop: string; org: string }) {
  const t = useT();
  const [scope, setScope] = useState<'shop' | 'org'>('shop');
  const [state, action, pending] = useActionState<UnsubscribeState>(unsubscribeAction.bind(null, token, scope), { status: 'idle' });

  if (state.status === 'done') {
    return (
      <div className="card p-6 text-center page-in">
        <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'color-mix(in srgb, var(--c-success) 14%, transparent)', color: 'var(--c-success)' }}>
          <IconCheck size={28} />
        </span>
        <h2 className="t-title3 m-0">{t('unsubscribe.doneTitle')}</h2>
        <p className="t-body t-2 mt-2 mb-0">{t(scope === 'shop' ? 'unsubscribe.doneShop' : 'unsubscribe.doneOrg', { shop, org })}</p>
      </div>
    );
  }

  return (
    <form action={action}>
      <section className="inset-group">
        <div className="list">
          {(['shop', 'org'] as const).map((s) => (
            <label key={s} className="row cursor-pointer">
              <input type="radio" name="scope" className="sr-only" checked={scope === s} onChange={() => setScope(s)} />
              <span className="row-main row-title">{t(s === 'shop' ? 'unsubscribe.fromShop' : 'unsubscribe.fromOrg', { shop, org })}</span>
              {scope === s ? <IconCheck size={20} style={{ color: 'var(--c-accent)' }} /> : <span className="w-5" />}
            </label>
          ))}
        </div>
        <p className="inset-group-foot">{t('unsubscribe.foot')}</p>
      </section>
      {state.status === 'error' ? <p className="t-sub mb-4" role="alert" style={{ color: 'var(--c-error)' }}>{t(`common:error.${state.error ?? 'internal'}`)}</p> : null}
      <button type="submit" className="btn btn-primary btn-large" disabled={pending}>{t('unsubscribe.button')}</button>
    </form>
  );
}
