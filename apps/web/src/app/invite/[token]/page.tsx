import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { staffAppMetadata } from '@/lib/manifests';
import { InviteAccept } from './invite-accept';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { ...staffAppMetadata(), title: t('invite.metaTitle'), robots: { index: false } };
}

// the link in an invite: /invite/<token>, made by the api
export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  return <InviteAccept token={token} />;
}
