'use client';

// what a person sees when a screen breaks: calm, one way forward, nothing technical. the error
// itself goes to the super admin's Errors screen (lib/report-error.ts)

import Link from 'next/link';
import { useEffect } from 'react';
import { Empty } from '@/components/ui/kit';
import { IconWarning } from '@/components/ui/icons';
import { useT } from '@/lib/i18n-client';
import { reportError } from '@/lib/report-error';
import { isStaleChunk, reloadForNewVersion } from '@/lib/new-version';

export function ErrorScreen({ error, reset, home }: { error: Error & { digest?: string }; reset: () => void; home: string }) {
  const t = useT();
  useEffect(() => {
    // a screen of the old version after a deploy: the new version loads instead of an error
    if (isStaleChunk(error) && reloadForNewVersion()) return;
    reportError({ source: 'boundary', error });
  }, [error]);
  return (
    <div className="grid place-items-center py-16 px-4" role="alert">
      <Empty
        icon={<IconWarning size={40} />}
        title={t('issues.boundary.title')}
        body={t('issues.boundary.body')}
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="btn btn-primary" onClick={() => reset()}>{t('issues.boundary.retry')}</button>
            <Link href={home} className="btn btn-gray">{t('issues.boundary.home')}</Link>
          </div>
        }
      />
    </div>
  );
}
