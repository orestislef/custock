'use client';

// offered right after "tell me when it is back": notifications reach people first. one tap asks
// the browser. on an iphone that is not on the home screen yet, it shows how to get there.

import { useState } from 'react';
import { AppIcon, InstallSteps } from '@/components/pwa/install-coach';
import { usePushSwitch } from '@/components/pwa/push-row';
import { IconBell } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { orgIconSrc } from './org-coach';
import { useShopper } from './shopper-context';

export function PushNudge() {
  const t = useT();
  const { api, follow, slug, orgName, iconVersion } = useShopper();
  const push = usePushSwitch(api, follow?.orgId ?? null);
  const [steps, setSteps] = useState(false);
  const [done, setDone] = useState(false);
  if (!push.ready || push.on || done || push.blocked === 'off' || push.blocked === 'unsupported' || push.blocked === 'denied') return null;
  return (
    <div className="card p-4 page-in">
      <div className="flex gap-3 items-start">
        <span className="icon-tile flex-none"><IconBell size={18} /></span>
        <div className="flex-1 min-w-0">
          <p className="t-headline m-0">{t('push.nudgeTitle')}</p>
          <p className="t-sub t-2 m-0 mt-1">{push.blocked === 'install' ? t('push.why.install') : t('push.nudgeBody', { org: orgName })}</p>
          <div className="flex gap-2 mt-3 flex-wrap">
            {push.blocked === 'install' ? (
              <button type="button" className="btn btn-primary" onClick={() => setSteps(true)}>{t('pwa.showHow')}</button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={push.busy} onClick={() => void push.toggle(true)}>{t('push.turnOn')}</button>
            )}
            <button type="button" className="btn btn-plain" onClick={() => setDone(true)}>{t('pwa.notNow')}</button>
          </div>
          {push.why && push.why !== push.blocked ? <p className="t-foot t-2 m-0 mt-2" role="status">{t(`push.why.${push.why}`)}</p> : null}
        </div>
      </div>
      <InstallSteps open={steps} onClose={() => setSteps(false)} appName={orgName} icon={<AppIcon src={orgIconSrc(slug, iconVersion)} size={44} label={orgName} />} />
    </div>
  );
}
