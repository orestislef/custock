'use client';

// "hear about offers first" on a business's pages, for signed in followers only. the same three
// ways out as the staff card: turn on, not now, don't ask again.

import { AppIcon } from '@/components/pwa/install-coach';
import { PushCard } from '@/components/pwa/push-card';
import { useT } from '@/lib/i18n-client';
import { orgIconSrc } from './org-coach';
import { useShopper } from './shopper-context';

export function CustomerPushCard({ className, installCoachShown }: { className?: string; installCoachShown?: boolean }) {
  const t = useT();
  const { api, status, follow, slug, orgName, iconVersion } = useShopper();
  if (status !== 'signedIn' || !follow) return null;
  return (
    <PushCard api={api} orgId={follow.orgId} place={`org.${slug}`} className={className} installCoachShown={installCoachShown}
      title={t('push.card.customerTitle')} body={t('push.card.customerBody', { org: orgName })} later={t('push.card.customerLater')}
      onTitle={t('push.card.customerOnTitle')} onBody={t('push.card.customerOnBody', { org: orgName })}
      appName={orgName} appIcon={<AppIcon src={orgIconSrc(slug, iconVersion)} size={44} label={orgName} />} />
  );
}
