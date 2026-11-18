import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { ResetPassword } from './reset-password';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('reset.metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

// the link in a forgot password email: /admin/reset/<token>, made by the api
export default async function ResetPage({ params }: PageProps<'/admin/reset/[token]'>) {
  const { token } = await params;
  return <ResetPassword token={token} />;
}
