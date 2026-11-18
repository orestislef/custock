import type { Metadata } from 'next';
import { getT } from '@/lib/i18n-server';
import { ForgotPassword } from './forgot-password';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('forgot.metaTitle'), robots: { index: false } };
}

// forgot password: /admin/forgot, optionally ?email= from the sign in page
export default async function ForgotPage({ searchParams }: PageProps<'/admin/forgot'>) {
  const q = await searchParams;
  const email = typeof q.email === 'string' ? q.email.slice(0, 254) : '';
  return <ForgotPassword initialEmail={email} />;
}
