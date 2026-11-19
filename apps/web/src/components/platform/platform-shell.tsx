'use client';

// the frame of the super admin screens: a translucent toolbar with the platform name and the
// account sheet. one centered column, phone and desktop. the way back into the business that was
// open is a quiet chip on All businesses, not a back arrow.

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePlatform } from '@/components/admin/admin-context';
import { Avatar } from '@/components/ui/kit';
import { LocaleSwitch, Sheet } from '@/components/ui/client-kit';
import { AppearanceRow } from '@/components/ui/appearance-switch';
import { OtherDevicesRow } from '@/components/ui/other-devices-row';
import { IconLogout, IconShield } from '@/components/ui/icons';
import { PlatformBanners } from './bits';
import { PushRow } from '@/components/pwa/push-row';
import { AppIcon, InstallSteps } from '@/components/pwa/install-coach';
import { basePath } from '@/lib/api-client';
import { refreshSubscription } from '@/lib/push';

export function SuperAdminPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 t-cap2" style={{ background: 'var(--c-accent-tint)', color: 'var(--c-accent)', fontWeight: 600 }}>
      <IconShield size={12} />{label}
    </span>
  );
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const { t, me, logout, api, locale } = usePlatform();
  const [installSteps, setInstallSteps] = useState(false);
  // a browser that rotated its subscription, or the same super admin signing in again
  useEffect(() => { void refreshSubscription(api, { orgId: null, locale: locale as 'en' }); }, [api, locale]);
  const [userOpen, setUserOpen] = useState(false);
  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#main" className="skip-link t-sub">{t('admin.skip')}</a>
      <header className="bar" data-toolbar>
        <div className="flex items-center gap-2 h-[52px] px-safe-4 md:px-safe-8 max-w-[1100px] w-full mx-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          {/* all businesses is the root of a super admin: the name, never a back arrow */}
          <Link href="/admin/platform" className="t-headline t-display hover:no-underline inline-flex items-center min-h-[44px]" style={{ color: 'var(--c-ink)' }}>Custock</Link>
          <span id="bar-title" className="t-headline flex-1 text-center truncate opacity-0 transition-opacity" aria-hidden="true" />
          <SuperAdminPill label={t('platform.superadmin')} />
          <button type="button" className="icon-btn" aria-label={t('admin.account')} onClick={() => setUserOpen(true)}>
            <Avatar name={me.user.displayName} size={30} src={(me.user as { avatarUrl?: string | null }).avatarUrl} />
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="outline-none flex-1 px-safe-4 md:px-safe-8 pb-[max(4rem,calc(2rem+env(safe-area-inset-bottom)))] w-full max-w-[1100px] mx-auto">
        <PlatformBanners me={me} t={t} />
        {children}
      </main>
      <Sheet open={userOpen} onClose={() => setUserOpen(false)} title={t('admin.account')}>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={me.user.displayName} size={48} src={(me.user as { avatarUrl?: string | null }).avatarUrl} />
          <div className="min-w-0">
            <p className="t-headline m-0 truncate">{me.user.displayName}</p>
            <p className="t-sub t-2 m-0 truncate">{me.user.email}</p>
          </div>
        </div>
        <section className="inset-group" style={{ marginBottom: 16 }}>
          <div className="list">
            <PushRow api={api} orgId={null} title={t('push.staffTitle')} sub={t('push.platformSub')} onInstall={() => setInstallSteps(true)} />
          </div>
        </section>
        <OtherDevicesRow api={api} />
        <ul className="list mb-2" role="list">
          <li className="row"><span className="row-main row-title">{t('locale.label')}</span><LocaleSwitch /></li>
          <AppearanceRow />
          <li>
            <button type="button" className="row" onClick={() => void logout()} style={{ color: 'var(--c-error)' }}>
              <IconLogout size={20} />
              <span className="row-main row-title">{t('common:action.signOut')}</span>
            </button>
          </li>
        </ul>
      </Sheet>
      <InstallSteps open={installSteps} onClose={() => setInstallSteps(false)} appName="Custock" icon={<AppIcon src={`${basePath}/icons/icon-192.png`} size={56} label="Custock" />} />
    </div>
  );
}
