'use client';

// a lost or shared phone: every device signed in to this account, in plain words (Chrome on
// Windows, Safari on iPhone), when each was last used, and one tap to sign a device out. with two
// or more others there is also one tap for all of them. this device is marked and stays.

import { useEffect, useState } from 'react';
import type { CustockApi, SessionDevice } from '@custock/core';
import type { TFunction } from '@custock/i18n/client';
import { useToast } from '@/components/ui/client-kit';
import { useLocale, useT } from '@/lib/i18n-client';
import { date, relative } from '@/lib/format';

export function deviceName(t: TFunction, d: Pick<SessionDevice, 'browser' | 'os'>): string {
  if (d.browser === 'other' && d.os === 'other') return t('admin.device.unknown');
  return t('admin.device.on', { browser: t(`admin.device.browser.${d.browser}`), os: t(`admin.device.os.${d.os}`) });
}

// tight in the account sheets, where groups sit 16px apart; the customer page keeps its own spacing
export function OtherDevicesRow({ api, tight = true }: { api: CustockApi; tight?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [devices, setDevices] = useState<SessionDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.otherSessions().then((r) => { if (alive) setDevices(r.devices ?? []); }, () => { if (alive) setDevices(null); });
    return () => { alive = false; };
  }, [api]);

  if (!devices?.length) return null;
  const others = devices.filter((d) => !d.current);

  const signOutOne = async (d: SessionDevice) => {
    if (busy) return;
    setBusy(d.id);
    try {
      await api.signOutDevice(d.id);
      setDevices((list) => (list ?? []).filter((x) => x.id !== d.id));
      toast(t('admin.deviceSignedOut', { device: deviceName(t, d) }));
    } catch (e) {
      // already gone (signed out elsewhere, expired): it just leaves the list
      if ((e as { status?: number } | null)?.status === 404) setDevices((list) => (list ?? []).filter((x) => x.id !== d.id));
      else toast(t('common:error.internal'));
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    if (busy) return;
    setBusy('others');
    try {
      const r = await api.signOutOthers();
      toast(t('admin.signedOutOthers', { count: r.signedOut || others.length }));
      setDevices((list) => (list ?? []).filter((x) => x.current));
    } catch {
      toast(t('common:error.internal'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="inset-group" style={tight ? { marginBottom: 16 } : undefined}>
      <h3 className="inset-group-head">{t('admin.devices')}</h3>
      <ul className="list" role="list">
        {devices.map((d) => {
          const name = deviceName(t, d);
          return (
            <li key={d.id} className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
              <span className="row-main" style={{ minWidth: 'min(100%, 10rem)' }}>
                <span className="row-title block">{name}</span>
                <span className="row-sub block">
                  {d.current
                    ? t('admin.thisDevice')
                    : `${t('admin.deviceUsed', { when: relative(d.lastUsedAt, locale) })} · ${t('admin.deviceSince', { date: date(d.signedInAt, locale) })}`}
                </span>
              </span>
              {d.current ? null : (
                <button type="button" className="btn btn-gray" disabled={busy !== null} aria-label={t('admin.signOutDeviceLabel', { device: name })} onClick={() => void signOutOne(d)}>
                  {t('admin.signOutDevice')}
                </button>
              )}
            </li>
          );
        })}
        {others.length >= 2 ? (
          <li>
            <button type="button" className="row" disabled={busy !== null} onClick={() => void signOutOthers()} style={{ color: 'var(--c-error)' }}>
              <span className="row-main row-title">{t('admin.signOutOthers')}</span>
            </button>
          </li>
        ) : null}
      </ul>
      {others.length === 0 ? <p className="inset-group-foot">{t('admin.onlyThisDevice')}</p> : null}
    </section>
  );
}
