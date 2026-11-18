'use client';

import { AppIcon, InstallCoach } from './install-coach';
import { basePath } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';

// on the front door, for phones: the team app on the home screen
export function LandingCoach() {
  const t = useT();
  return (
    <InstallCoach place="landing" appName="Custock" className="mt-8 text-left"
      icon={<AppIcon src={`${basePath}/icons/icon-192.png`} size={44} label="Custock" />} body={t('pwa.staffCoachBody')} />
  );
}
