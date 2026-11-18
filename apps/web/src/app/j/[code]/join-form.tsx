'use client';

import { useActionState, useState } from 'react';
import type { Category } from '@custock/core';
import { joinAction, type JoinState } from '@/app/actions';
import { useLocale, useT } from '@/lib/i18n-client';
import { categoryName } from '@/lib/use-names';
import { IconCheck, IconMail } from '@/components/ui/icons';
import { cleanLine, normalizeEmail } from '@custock/core';

const initial: JoinState = { status: 'idle' };

export function JoinForm({ code, interests, notifyName, orgName }: { code: string; interests: Category[]; notifyName: string | null; orgName: string }) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(joinAction.bind(null, code), initial);
  const [picked, setPicked] = useState<string[]>([]);

  if (state.status === 'pending') {
    return (
      <div className="card p-6 text-center page-in">
        <span className="inline-grid place-items-center w-14 h-14 rounded-full mb-3" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)' }}>
          <IconMail size={28} />
        </span>
        <h2 className="t-title2 m-0">{t('join.checkTitle')}</h2>
        <p className="t-body t-2 mt-2 mb-0">{t('join.checkBody', { email: state.email })}</p>
        <p className="t-foot t-2 mt-4 mb-0">{t('join.checkHint')}</p>
        {state.devConfirmLink ? (
          <p className="mt-5 mb-0">
            <a className="btn btn-tinted" href={state.devConfirmLink}>{t('join.devConfirm')}</a>
          </p>
        ) : null}
      </div>
    );
  }

  const err = state.status === 'error' ? state.error : undefined;

  return (
    <form action={action} noValidate>
      {notifyName ? (
        <div className="tip mb-5"><span className="t-sub">{t('join.notifyIntent', { product: notifyName })}</span></div>
      ) : null}

      <section className="inset-group">
        <div className="list">
          <label className="block">
            <span className="field-label">{t('join.name')}</span>
            <input className="field pt-1" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required maxLength={40} placeholder={t('join.namePlaceholder')} aria-invalid={err === 'name'}
              onBlur={(e) => { e.currentTarget.value = cleanLine(e.currentTarget.value); }} />
          </label>
          <label className="block row-sep relative">
            <span className="field-label">{t('join.email')}</span>
            <input className="field pt-1" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" maxLength={254}
              required placeholder="name@example.com" defaultValue={state.email} aria-invalid={err === 'email'}
              onBlur={(e) => { e.currentTarget.value = normalizeEmail(e.currentTarget.value); }} />
          </label>
        </div>
        {err === 'name' ? <p className="inset-group-foot" style={{ color: 'var(--c-error)' }}>{t('join.nameInvalid')}</p> : null}
        {err === 'email' ? <p className="inset-group-foot" style={{ color: 'var(--c-error)' }}>{t('join.emailInvalid')}</p> : null}
      </section>

      {interests.length ? (
        <section className="inset-group">
          <h2 className="inset-group-head">{t('join.interests')}</h2>
          <div className="flex flex-wrap gap-2 px-1">
            {interests.map((c) => {
              const on = picked.includes(c.id);
              return (
                <label key={c.id} className="badge cursor-pointer select-none" style={{ minHeight: 44, padding: '10px 16px', fontSize: 15, background: on ? 'var(--c-ink)' : 'var(--c-surface)', color: on ? 'var(--c-shelf)' : 'var(--c-ink)' }}>
                  <input type="checkbox" name="interests" value={c.id} className="sr-only" checked={on} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
                  {on ? <IconCheck size={14} /> : null}
                  {categoryName(c, locale)}
                </label>
              );
            })}
          </div>
          <p className="inset-group-foot">{t('join.interestsFoot')}</p>
        </section>
      ) : null}

      <section className="inset-group">
        <h2 className="inset-group-head">{t('join.channels')}</h2>
        <div className="list">
          <Check name="emailNews" title={t('join.emailNews')} sub={t('join.emailNewsSub', { org: orgName })} />
          <Check name="push" title={t('join.push')} sub={t('join.pushSub')} />
        </div>
        <p className="inset-group-foot">{t('join.channelsFoot')}</p>
      </section>

      <section className="inset-group">
        <div className="list">
          <label className="row cursor-pointer">
            <input type="checkbox" className="check" name="over15" aria-invalid={err === 'over15'} />
            <span className="row-main row-title">{t('join.over15')}</span>
          </label>
        </div>
        {err === 'over15' ? <p className="inset-group-foot" style={{ color: 'var(--c-error)' }}>{t('join.over15Needed')}</p> : null}
      </section>

      {err && err !== 'email' && err !== 'over15' && err !== 'name' ? (
        <p className="t-sub mb-4" role="alert" style={{ color: 'var(--c-error)' }}>{t(`common:error.${err}`)}</p>
      ) : null}

      <button className="btn btn-primary btn-large" type="submit" disabled={pending}>
        {pending ? t('join.sending') : t('join.submit')}
      </button>
      <p className="t-foot t-2 mt-4 text-center">{t('join.privacy', { org: orgName })}</p>
    </form>
  );
}

function Check({ name, title, sub, invalid }: { name: string; title: string; sub?: string; invalid?: boolean }) {
  return (
    <label className="row cursor-pointer">
      <span className="row-main">
        <span className="row-title block">{title}</span>
        {sub ? <span className="row-sub block">{sub}</span> : null}
      </span>
      <span className="switch">
        <input type="checkbox" role="switch" name={name} aria-invalid={invalid} />
        <span className="track" />
        <span className="knob" />
      </span>
    </label>
  );
}
