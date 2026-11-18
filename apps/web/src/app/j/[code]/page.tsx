import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isUnavailable, Unavailable } from '@/components/platform/unavailable';
import { serverApi } from '@/lib/api-server';
import { getT } from '@/lib/i18n-server';
import { PublicShell } from '@/components/public/public-shell';
import { Photo } from '@/components/ui/client-kit';
import { JoinForm } from './join-form';
import { orgAppMetadata } from '@/lib/manifests';

export async function generateMetadata({ params }: PageProps<'/j/[code]'>): Promise<Metadata> {
  const { code } = await params;
  const { t, locale } = await getT();
  try {
    const { api } = await serverApi(locale);
    const page = await api.joinPage(code);
    // adding this page to the home screen installs the business's app, when we know its address
    const slug = (page as { orgSlug?: string }).orgSlug;
    return { ...(slug ? orgAppMetadata(slug, page.orgName) : {}), title: t('join.metaTitle', { scope: page.scopeName }), robots: { index: false } };
  } catch {
    return { title: { absolute: 'Custock' } };
  }
}

export default async function JoinPageRoute({ params, searchParams }: PageProps<'/j/[code]'>) {
  const { code } = await params;
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { api } = await serverApi(locale);
  const result = await api.joinPage(code).catch((e: unknown) => (isUnavailable(e) ? 'unavailable' as const : null));
  if (result === 'unavailable') return <Unavailable />;
  const page = result;
  if (!page) notFound();

  const notifyName = typeof sp.notify === 'string' ? sp.notify : null;

  return (
    <PublicShell orgName={page.orgName} t={t}>
      {page.imageUrl ? (
        <div className="card mb-5" style={{ aspectRatio: '16 / 9' }}>
          <Photo src={page.imageUrl} alt={page.scopeName} className="w-full h-full" rounded={0} />
        </div>
      ) : null}
      <h1 className="t-large t-display m-0">{page.scopeName}</h1>
      <p className="t-body t-2 mt-3 mb-6">{t('join.lead', { scope: page.scopeName })}</p>

      {page.disabled ? (
        <div className="tip"><span className="t-sub">{t('common:error.join_link_disabled')}</span></div>
      ) : (
        <JoinForm code={code} interests={page.interests} notifyName={notifyName} orgName={page.orgName} />
      )}
    </PublicShell>
  );
}
