'use client';

// a lost or shared phone: how many other devices are signed in to this account, and one tap to
// sign them all out. this device stays signed in.

import { useEffect, useState } from 'react';
import type { CustockApi } from '@custock/core';
import { useToast } from '@/components/ui/client-kit';
import { useT } from '@/lib/i18n-client';

export function OtherDevicesRow({ api }: { api: CustockApi }) {
  const t = useT();
  const toast = useToast();
  const [others, setOthers] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.otherSessions().then((r) => { if (alive) setOthers(r.others); }, () => { if (alive) setOthers(null); });
    return () => { alive = false; };
  }, [api]);

  if (others === null) return null;

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.signOutOthers();
      toast(t('admin.signedOutOthers', { count: others }));
      setOthers(0);
    } catch {
      toast(t('common:error.internal'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
      <span className="row-main" style={{ minWidth: 'min(100%, 10rem)' }}>
        <span className="row-title block">{t('admin.otherDevices')}</span>
        <span className="row-sub block">{others ? t('admin.otherDevicesCount', { count: others }) : t('admin.onlyThisDevice')}</span>
      </span>
      {others ? (
        <button type="button" className="btn btn-gray" disabled={busy} onClick={() => void signOut()}>{t('admin.signOutOthers')}</button>
      ) : null}
    </li>
  );
}
