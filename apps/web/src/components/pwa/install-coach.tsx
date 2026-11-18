'use client';

// "add to home screen", offered in context and never in the way: a card that can be closed for good
// (30 days per place). chrome and android get a real install button. safari has no prompt, so the
// card opens the two taps in the share sheet. hidden once the app runs from the home screen.

import { useState, type ReactNode } from 'react';
import { Sheet } from '@/components/ui/client-kit';
import { IconAddSquare, IconCheck, IconClose, IconShare } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { useCoachDismissed, useInstall } from '@/lib/pwa';

export function InstallCoach({ place, appName, icon, body, className }: { place: string; appName: string; icon: ReactNode; body: string; className?: string }) {
  const t = useT();
  const { mode, install } = useInstall();
  const [dismissed, dismiss] = useCoachDismissed(place);
  const [steps, setSteps] = useState(false);
  if (dismissed || mode === 'installed' || mode === 'none') return null;
  return (
    <>
      <section className={`card p-4 flex gap-3 items-start page-in ${className ?? ''}`} aria-label={t('pwa.coachTitle', { app: appName })}>
        <span className="flex-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="t-headline m-0">{t('pwa.coachTitle', { app: appName })}</h2>
          <p className="t-sub t-2 m-0 mt-1">{body}</p>
          <div className="mt-3">
            {mode === 'prompt' ? (
              <button type="button" className="btn btn-primary" onClick={() => void install()}>{t('pwa.install')}</button>
            ) : (
              <button type="button" className="btn btn-tinted" onClick={() => setSteps(true)}>{t('pwa.showHow')}</button>
            )}
          </div>
        </div>
        <button type="button" className="icon-btn -m-2 flex-none" style={{ color: 'var(--c-ink-2)' }} aria-label={t('pwa.notNow')} onClick={dismiss}>
          <IconClose size={18} />
        </button>
      </section>
      <InstallSteps open={steps} onClose={() => setSteps(false)} appName={appName} icon={icon} />
    </>
  );
}

// the same steps, from a settings row instead of the card
export function InstallRow({ appName, icon, render }: { appName: string; icon: ReactNode; render: (open: () => void, label: string) => ReactNode }) {
  const t = useT();
  const { mode, install } = useInstall();
  const [steps, setSteps] = useState(false);
  if (mode === 'installed' || mode === 'none') return null;
  return (
    <>
      {render(() => (mode === 'prompt' ? void install() : setSteps(true)), t('pwa.addToHome'))}
      <InstallSteps open={steps} onClose={() => setSteps(false)} appName={appName} icon={icon} />
    </>
  );
}

export function InstallSteps({ open, onClose, appName, icon }: { open: boolean; onClose: () => void; appName: string; icon: ReactNode }) {
  const t = useT();
  const step = (n: number, glyph: ReactNode, text: ReactNode) => (
    <li className="row has-icon" style={{ '--sep-inset': '60px' } as React.CSSProperties}>
      <span className="icon-tile" aria-hidden="true">{glyph}</span>
      <span className="row-main"><span className="sr-only">{t('pwa.step', { n })} </span><span className="row-title block">{text}</span></span>
    </li>
  );
  return (
    <Sheet open={open} onClose={onClose} title={t('pwa.stepsTitle')} footer={<button type="button" className="btn btn-primary btn-large" onClick={onClose}>{t('common:action.done')}</button>}>
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <p className="t-sub t-2 m-0 flex-1">{t('pwa.stepsLead', { app: appName })}</p>
      </div>
      <ol className="list mb-3" role="list">
        {step(1, <IconShare size={20} />, t('pwa.step1'))}
        {step(2, <IconAddSquare size={20} />, t('pwa.step2'))}
        {step(3, <IconCheck size={20} />, t('pwa.step3', { app: appName }))}
      </ol>
      <p className="t-foot t-2 m-0 mb-2 px-1">{t('pwa.stepsFoot')}</p>
    </Sheet>
  );
}

// the app icon as it will look on the home screen
export function AppIcon({ src, size = 48, label }: { src: string; size?: number; label?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label ?? ''} width={size} height={size} style={{ width: size, height: size, borderRadius: size * 0.225, display: 'block', boxShadow: '0 0 0 0.5px var(--c-line)' }} />;
}
