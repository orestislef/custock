'use client';

// switching between businesses: for someone who works in several, and for a super admin, who can
// open any business. the one on screen has a check.

import Link from 'next/link';
import { useAdmin } from '@/components/admin/admin-context';
import { Sheet } from '@/components/ui/client-kit';
import { IconCheck, IconChevronRight, IconShield } from '@/components/ui/icons';
import { BusinessMark } from '@/components/ui/business-mark';

export function OrgSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, org, openOrg, t, superadmin } = useAdmin();
  const own = me.orgs.filter((o) => !o.platformAccess);
  const others = me.orgs.filter((o) => o.platformAccess);
  const row = (o: (typeof me.orgs)[number]) => (
    <li key={o.orgId}>
      <button type="button" className="row has-icon" onClick={() => { onClose(); if (o.orgId !== org.orgId) openOrg(o.orgId); }} aria-current={o.orgId === org.orgId ? 'true' : undefined}>
        <BusinessMark logoUrl={o.logoUrl} />
        <span className="row-main">
          <span className="row-title block truncate">{o.name}</span>
          {o.suspended && superadmin ? <span className="row-sub block">{t('platform.pausedBadge')}</span> : null}
        </span>
        {o.orgId === org.orgId ? <IconCheck size={18} style={{ color: 'var(--c-accent)' }} /> : null}
      </button>
    </li>
  );
  return (
    <Sheet open={open} onClose={onClose} title={t('platform.switchBusiness')}>
      {superadmin ? (
        <ul className="list mb-4" role="list">
          <li>
            <Link href="/admin/platform" className="row has-icon" onClick={onClose}>
              <span className="icon-tile"><IconShield size={18} /></span>
              <span className="row-main row-title">{t('platform.allBusinesses')}</span>
              <IconChevronRight size={16} className="chev" />
            </Link>
          </li>
        </ul>
      ) : null}
      {own.length ? (
        <>
          {superadmin ? <h2 className="inset-group-head">{t('platform.yourBusinesses')}</h2> : null}
          <ul className="list mb-4" role="list">{own.map(row)}</ul>
        </>
      ) : null}
      {others.length ? (
        <>
          <h2 className="inset-group-head">{t('platform.everyBusiness')}</h2>
          <ul className="list mb-2" role="list">{others.map(row)}</ul>
        </>
      ) : null}
    </Sheet>
  );
}
