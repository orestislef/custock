import type { Metadata } from 'next';
import { staffAppMetadata } from '@/lib/manifests';
import { InviteAccept } from './invite-accept';

export const metadata: Metadata = { ...staffAppMetadata(), title: 'Invite', robots: { index: false } };

// the link in an invite: /invite/<token>, made by the api
export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  return <InviteAccept token={token} />;
}
