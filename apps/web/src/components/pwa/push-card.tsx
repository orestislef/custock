'use client';

// asks once, in context, whether this device should get notifications. three ways out: turn on
// (the browser's prompt follows the tap), not now (back in 14 days), don't ask again (gone for good
// on this device). never shown when notifications are already on, blocked, or impossible here.
// on an iphone that is not on the home screen yet, push needs the install first: the card then
// points at the install steps, unless the page already shows its own install coach.

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CustockApi } from '@custock/core';
import { InstallSteps } from '@/components/pwa/install-coach';
import { TestPushButton, usePushSwitch } from '@/components/pwa/push-row';
import { IconBell, IconCheck, IconClose } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';

const DAY = 86_400_000;
const SNOOZE_DAYS = 14;

function subscribe(cb: () => void) {
  window.addEventListener('custock-push-card', cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener('custock-push-card', cb); window.removeEventListener('storage', cb); };
}

// "never", or the time until which the card stays away
function useSnooze(place: string): [boolean, (mode: 'later' | 'never') => void] {
  const key = `custock.pushCard.${place}`;
  const hidden = useSyncExternalStore(
    subscribe,
    () => {
      const v = localStorage.getItem(key);
      return v === 'never' || (v !== null && Number(v) > Date.now());
    },
    () => true,
  );
  const hide = (mode: 'later' | 'never') => {
    localStorage.setItem(key, mode === 'never' ? 'never' : String(Date.now() + SNOOZE_DAYS * DAY));
    window.dispatchEvent(new Event('custock-push-card'));
  };
  return [hidden, hide];
}

export function PushCard({ api, orgId, place, title, body, onTitle, onBody, later, appName, appIcon, className, installCoachShown }: {
  api: CustockApi;
  orgId: string | null;
  place: string;
  title: string;
  body: string;
  onTitle: string;
  onBody: string;
  later: string;
  appName: string;
  appIcon: ReactNode;
  className?: string;
  // the page shows an install coach already, so the card stays away until the app is installed
  installCoachShown?: boolean;
}) {
  const t = useT();
  const push = usePushSwitch(api, orgId);
  const [hidden, hide] = useSnooze(place);
  const [steps, setSteps] = useState(false);
  // turned on from this card: it stays to say so and to offer a test
  const [justOn, setJustOn] = useState(false);
  const [closed, setClosed] = useState(false);

  if (!push.ready || closed) return null;

  if (justOn && push.on) {
    return (
      <section className={`card p-4 page-in ${className ?? ''}`} aria-live="polite">
        <div className="flex gap-3 items-start">
          <span className="icon-tile flex-none" style={{ background: 'color-mix(in srgb, var(--c-success) 16%, transparent)', color: 'var(--c-success)' }}><IconCheck size={18} /></span>
          <div className="flex-1 min-w-0">
            <p className="t-headline m-0">{onTitle}</p>
            <p className="t-sub t-2 m-0 mt-1">{onBody}</p>
            <div className="flex gap-2 mt-3 flex-wrap items-center">
              <TestPushButton api={api} orgId={orgId} variant="tinted" />
            </div>
          </div>
          <button type="button" className="icon-btn flex-none -mr-2 -mt-2" aria-label={t('common:action.close')} onClick={() => setClosed(true)}><IconClose size={18} /></button>
        </div>
      </section>
    );
  }

  if (hidden || push.on || push.blocked === 'off' || push.blocked === 'denied' || push.blocked === 'unsupported') return null;
  const install = push.blocked === 'install';
  if (install && installCoachShown) return null;

  const turnOn = async () => {
    const ok = await push.toggle(true);
    if (ok) setJustOn(true);
  };

  return (
    <section className={`card p-4 page-in ${className ?? ''}`} aria-labelledby={`push-card-${place}`}>
      <div className="flex gap-3 items-start">
        <span className="icon-tile flex-none"><IconBell size={18} /></span>
        <div className="flex-1 min-w-0">
          <h2 id={`push-card-${place}`} className="t-headline m-0">{title}</h2>
          <p className="t-sub t-2 m-0 mt-1">{install ? t('push.why.install') : body}</p>
          <div className="flex gap-2 mt-3 flex-wrap">
            {install ? (
              <button type="button" className="btn btn-primary" onClick={() => setSteps(true)}>{t('pwa.showHow')}</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={push.busy} onClick={() => void turnOn()}>{t('push.card.turnOn')}</button>
            )}
            <button type="button" className="btn btn-gray" onClick={() => hide('later')}>{t('push.card.notNow')}</button>
            <button type="button" className="btn btn-plain" onClick={() => hide('never')}>{t('push.card.never')}</button>
          </div>
          {push.why && push.why !== push.blocked ? <p className="t-foot m-0 mt-2" role="status" style={{ color: 'var(--c-error)' }}>{t(`push.why.${push.why}`)}</p> : null}
          <p className="t-foot t-2 m-0 mt-3">{later}</p>
        </div>
      </div>
      {install ? <InstallSteps open={steps} onClose={() => setSteps(false)} appName={appName} icon={appIcon} /> : null}
    </section>
  );
}
