import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { staffAppMetadata } from '@/lib/manifests';
import { PlatformInviteAccept } from './platform-invite-accept';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { ...staffAppMetadata(), title: t('platformInvite.metaTitle'), robots: { index: false } };
}

// the link in a super admin invite: /platform-invite/<token>, made by the api
export default async function PlatformInvitePage({ params }: PageProps<'/platform-invite/[token]'>) {
  const { token } = await params;
  return <PlatformInviteAccept token={token} />;
}
