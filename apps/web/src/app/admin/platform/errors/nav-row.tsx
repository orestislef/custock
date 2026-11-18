'use client';

// the way to the Errors screen from All businesses, with the number of open errors as a badge

import { useEffect, useState } from 'react';
import { usePlatform } from '@/components/admin/admin-context';
import { Row } from '@/components/ui/kit';
import { IconWarning } from '@/components/ui/icons';

export function ErrorsNavRow() {
  const { api, t } = usePlatform();
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api.platformErrors({ status: 'open' }).then((p) => { if (live) setOpen(p.counts.open); }).catch(() => {});
    return () => { live = false; };
  }, [api]);
  return (
    <Row href="/admin/platform/errors"
      leading={<span className="icon-tile"><IconWarning size={18} /></span>}
      title={t('issues.title')}
      subtitle={open == null ? undefined : open ? t('issues.navSub', { count: open }) : t('issues.navNone')}
      trailing={open ? <span className="badge badge-neg tnum" aria-hidden="true">{open}</span> : null} />
  );
}
