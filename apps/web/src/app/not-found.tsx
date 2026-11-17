import Link from 'next/link';
import { getT } from '@/lib/i18n-server';
import { Empty } from '@/components/ui/kit';
import { IconSearch } from '@/components/ui/icons';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <Empty
        icon={<IconSearch size={44} />}
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={<Link href="/" className="btn btn-tinted">{t('notFound.home')}</Link>}
      />
    </main>
  );
}
