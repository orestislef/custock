'use client';

import { AppIcon, InstallCoach } from '@/components/pwa/install-coach';
import { basePath } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

// "add <business> to your home screen", on the customer pages
export function OrgCoach({ className }: { className?: string }) {
  const t = useT();
  const { slug, orgName, iconVersion } = useShopper();
  return (
    <InstallCoach
      place={`org.${slug}`}
      appName={orgName}
      icon={<AppIcon src={orgIconSrc(slug, iconVersion)} size={48} label={orgName} />}
      body={t('pwa.orgCoachBody', { org: orgName })}
      className={className}
    />
  );
}

// the same versioned url the manifest uses, so the card shows what the home screen will
export function orgIconSrc(slug: string, version = '') {
  return `${basePath}/s/${encodeURIComponent(slug)}/icon/192${version ? `?v=${version}` : ''}`;
}
