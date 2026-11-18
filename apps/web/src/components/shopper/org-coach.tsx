'use client';

import { AppIcon, InstallCoach } from '@/components/pwa/install-coach';
import { basePath } from '@/lib/api-client';
import { useT } from '@/lib/i18n-client';
import { useShopper } from './shopper-context';

// "add <business> to your home screen", on the customer pages
export function OrgCoach({ className }: { className?: string }) {
  const t = useT();
  const { slug, orgName } = useShopper();
  return (
    <InstallCoach
      place={`org.${slug}`}
      appName={orgName}
      icon={<AppIcon src={`${basePath}/s/${encodeURIComponent(slug)}/icon/192`} size={48} label={orgName} />}
      body={t('pwa.orgCoachBody', { org: orgName })}
      className={className}
    />
  );
}

export function orgIconSrc(slug: string) {
  return `${basePath}/s/${encodeURIComponent(slug)}/icon/192`;
}
